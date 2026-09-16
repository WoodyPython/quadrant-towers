import { pgTable, text } from 'drizzle-orm/pg-core';

export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
