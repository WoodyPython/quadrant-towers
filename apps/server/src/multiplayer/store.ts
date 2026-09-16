import type pg from 'pg';
import { ackSchema, presetSchema, type Ack } from '@quadrant/protocol';
import type {
  MatchState,
  EngineRegistry,
  Command,
} from '@quadrant/game-engine';
import { parseSnapshot } from './snapshot.js';

export interface Seat {
  id: string;
  displayName: string;
  seat: number;
  tokenHash: string;
  joinedAt: number;
  disconnectedAt: number | null;
  rematchVote: string | null;
}
export interface Room {
  id: string;
  code: string;
  preset: MatchState['preset'];
  status: 'lobby' | 'active' | 'finished' | 'closed';
  hostPlayerId: string | null;
  matchId: string | null;
  createdAt: number;
  players: Seat[];
}
export interface Aggregate {
  room: Room;
  state: MatchState | null;
}
export interface Receipt {
  actorId: string;
  commandId: string;
  fingerprint: string;
  response: Ack;
}
export interface Write {
  command?: { actorId: string | null; commandId: string; payload: Command };
  receipt?: Receipt;
}
export class Store {
  constructor(
    readonly pool: pg.Pool,
    readonly registry: EngineRegistry,
  ) {}
  async ids() {
    return (
      await this.pool.query<{ id: string }>(
        "SELECT id FROM rooms WHERE status <> 'closed'",
      )
    ).rows.map((r) => r.id);
  }
  async find(code: string) {
    return (
      await this.pool.query<{ id: string }>(
        'SELECT id FROM rooms WHERE code=$1',
        [code],
      )
    ).rows[0]?.id;
  }
  async create(room: Room) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO rooms (id,code,preset,status,host_player_id,match_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          room.id,
          room.code,
          room.preset,
          room.status,
          room.hostPlayerId,
          room.matchId,
          room.createdAt,
        ],
      );
      await this.save(client, { room, state: null }, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  private async load(client: pg.PoolClient, id: string): Promise<Aggregate> {
    const row = (
      await client.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!row) throw new Error('Room missing');
    const room: Room = {
      id: row.id,
      code: row.code,
      preset: presetSchema.parse(row.preset),
      status: row.status,
      hostPlayerId: row.host_player_id,
      matchId: row.match_id,
      createdAt: Number(row.created_at),
      players: [],
    };
    const seats = await client.query(
      'SELECT * FROM players WHERE room_id=$1 ORDER BY joined_at, seat',
      [id],
    );
    room.players = seats.rows.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      seat: p.seat,
      tokenHash: p.token_hash,
      joinedAt: Number(p.joined_at),
      disconnectedAt:
        p.disconnected_at === null ? null : Number(p.disconnected_at),
      rematchVote: p.rematch_vote,
    }));
    let state: MatchState | null = null;
    if (room.matchId) {
      const saved = (
        await client.query(
          'SELECT s.*, m.version AS match_version, m.status AS match_status FROM match_snapshots s JOIN matches m ON m.id=s.match_id WHERE match_id=$1',
          [room.matchId],
        )
      ).rows[0];
      if (!saved) throw new Error('Snapshot missing');
      state = parseSnapshot(saved.state, saved.schema_version, this.registry);
      if (
        state.id !== room.matchId ||
        state.version !== saved.version ||
        state.version !== saved.match_version ||
        state.preset !== room.preset ||
        room.players.length !== state.players.length ||
        room.players.length < 2 ||
        room.players.length > 4 ||
        state.players.some(
          (p) => !room.players.some((seat) => seat.id === p.id),
        ) ||
        saved.match_status !== (state.result ? 'finished' : 'active') ||
        room.status !== saved.match_status
      )
        throw new Error('Snapshot metadata mismatch');
    }
    return { room, state };
  }
  async transaction<T>(
    id: string,
    operation: (
      aggregate: Aggregate,
      receipt: (
        actorId: string,
        commandId: string,
      ) => Promise<Receipt | undefined>,
    ) => Promise<{ value: T; write?: Write }>,
  ): Promise<{ value: T; aggregate: Aggregate }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const aggregate = await this.load(client, id);
      const result = await operation(aggregate, async (actorId, commandId) => {
        const row = (
          await client.query(
            'SELECT * FROM command_receipts WHERE room_id=$1 AND actor_id=$2 AND command_id=$3',
            [id, actorId, commandId],
          )
        ).rows[0];
        return row
          ? {
              actorId,
              commandId,
              fingerprint: row.fingerprint,
              response: ackSchema.parse(row.response),
            }
          : undefined;
      });
      if (result.write) await this.save(client, aggregate, result.write);
      await client.query('COMMIT');
      return { value: result.value, aggregate };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async read(id: string) {
    return (await this.transaction(id, async () => ({ value: null })))
      .aggregate;
  }
  private async save(
    client: pg.PoolClient,
    { room, state }: Aggregate,
    write: Write,
  ) {
    await client.query(
      `UPDATE rooms SET status=$2, host_player_id=$3, match_id=$4,
       inactive_since=CASE WHEN $5::bigint IS NULL THEN NULL ELSE COALESCE(inactive_since,$5) END WHERE id=$1`,
      [
        room.id,
        room.status,
        room.hostPlayerId,
        room.matchId,
        room.players.every((p) => p.disconnectedAt !== null)
          ? Math.max(
              room.createdAt,
              ...room.players.map((p) => p.disconnectedAt ?? room.createdAt),
            )
          : null,
      ],
    );
    await client.query(
      'DELETE FROM players WHERE room_id=$1 AND NOT (id = ANY($2::uuid[]))',
      [room.id, room.players.map((p) => p.id)],
    );
    for (const p of room.players)
      await client.query(
        `INSERT INTO players (id,room_id,display_name,seat,token_hash,joined_at,disconnected_at,rematch_vote)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET disconnected_at=EXCLUDED.disconnected_at, rematch_vote=EXCLUDED.rematch_vote`,
        [
          p.id,
          room.id,
          p.displayName,
          p.seat,
          p.tokenHash,
          p.joinedAt,
          p.disconnectedAt,
          p.rematchVote,
        ],
      );
    if (state) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO matches (id,room_id,status,preset,seed,version,card_catalog_version,balance_version,deadline,result)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          state.id,
          room.id,
          state.result ? 'finished' : 'active',
          state.preset,
          state.seed,
          state.version,
          state.cardCatalogVersion,
          state.balanceVersion,
          state.turn.deadline,
          state.result,
        ],
      );
      if (!inserted.rows.length)
        await client.query(
          'UPDATE matches SET status=$2, version=$3, deadline=$4, result=$5 WHERE id=$1',
          [
            state.id,
            state.result ? 'finished' : 'active',
            state.version,
            state.turn.deadline,
            state.result,
          ],
        );
      await client.query(
        `INSERT INTO match_snapshots VALUES ($1,$2,1,$3,$4) ON CONFLICT (match_id) DO UPDATE SET version=EXCLUDED.version, state=EXCLUDED.state, created_at=EXCLUDED.created_at`,
        [state.id, state.version, state, state.lastCommandAt],
      );
      if (inserted.rows.length)
        await client.query(
          'INSERT INTO match_commands VALUES ($1,0,NULL,$2,$3,$4)',
          [
            state.id,
            `create:${state.id}`,
            {
              type: 'create_match',
              input: {
                id: state.id,
                playerIds: state.players.map((p) => p.id),
                preset: state.preset,
                seed: state.seed,
                now: state.lastCommandAt,
                cardCatalogVersion: state.cardCatalogVersion,
                balanceVersion: state.balanceVersion,
              },
            },
            state.lastCommandAt,
          ],
        );
      if (write.command)
        await client.query(
          'INSERT INTO match_commands VALUES ($1,$2,$3,$4,$5,$6)',
          [
            state.id,
            state.version,
            write.command.actorId,
            write.command.commandId,
            write.command.payload,
            state.lastCommandAt,
          ],
        );
    }
    if (write.receipt) {
      const r = write.receipt;
      await client.query(
        'INSERT INTO command_receipts (room_id,actor_id,command_id,fingerprint,response,match_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          room.id,
          r.actorId,
          r.commandId,
          r.fingerprint,
          r.response,
          'matchId' in r.response ? r.response.matchId : (state?.id ?? null),
        ],
      );
    }
    if (state?.result)
      await client.query(
        'UPDATE matches SET finished_at=COALESCE(finished_at,$2) WHERE id=$1',
        [state.id, state.lastCommandAt],
      );
  }

  async retentionCandidates(now: number): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT r.id FROM rooms r WHERE
      (r.status IN ('lobby','closed') AND r.inactive_since <= $1)
      OR EXISTS (SELECT 1 FROM matches m WHERE m.room_id=r.id AND m.finished_at <= $2)
      ORDER BY r.created_at LIMIT 100`,
      [now - 86_400_000, now - 30 * 86_400_000],
    );
    return result.rows.map((r) => r.id);
  }

  /** The caller holds the room queue; this transaction also excludes concurrent writes. */
  async cleanup(
    id: string,
    now: number,
    connected: string[],
  ): Promise<string[] | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const room = (
        await client.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (!room) {
        await client.query('COMMIT');
        return null;
      }
      const seats = (
        await client.query<{ id: string }>(
          'SELECT id FROM players WHERE room_id=$1',
          [id],
        )
      ).rows.map((p) => p.id);
      const expired = (
        await client.query<{ id: string }>(
          "SELECT id FROM matches WHERE room_id=$1 AND status='finished' AND finished_at <= $2",
          [id, now - 30 * 86_400_000],
        )
      ).rows.map((m) => m.id);
      const removeRoom =
        (['lobby', 'closed'].includes(room.status) &&
          room.inactive_since !== null &&
          Number(room.inactive_since) <= now - 86_400_000 &&
          !seats.some((p) => connected.includes(p))) ||
        (room.status === 'finished' && expired.includes(room.match_id));
      if (removeRoom) {
        // Never discard a newer or active match because older history expired.
        const newer = await client.query(
          'SELECT id FROM matches WHERE room_id=$1 AND (finished_at IS NULL OR finished_at > $2)',
          [id, now - 30 * 86_400_000],
        );
        if (newer.rows.length) {
          await client.query('COMMIT');
          return null;
        }
      }
      for (const table of ['match_snapshots', 'match_commands'])
        await client.query(
          `DELETE FROM ${table} WHERE match_id=ANY($1::uuid[])`,
          [expired],
        );
      await client.query(
        'DELETE FROM command_receipts WHERE room_id=$1 AND match_id=ANY($2::uuid[])',
        [id, expired],
      );
      await client.query('DELETE FROM matches WHERE id=ANY($1::uuid[])', [
        expired,
      ]);
      if (removeRoom) {
        await client.query('DELETE FROM command_receipts WHERE room_id=$1', [
          id,
        ]);
        await client.query('DELETE FROM players WHERE room_id=$1', [id]);
        await client.query('DELETE FROM rooms WHERE id=$1', [id]);
      }
      await client.query('COMMIT');
      return removeRoom ? seats : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
