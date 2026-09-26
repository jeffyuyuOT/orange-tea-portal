-- file_repository.category is the legacy free-text category column that
-- category_id (0021) superseded. FileRepositoryPage.jsx's upload() insert
-- only ever sets category_id, never this old column — but it was left
-- NOT NULL with no default, so every upload since 0021 has been failing a
-- NOT NULL violation on `category`, surfaced to the user as a plain "400"
-- from PostgREST with no readable message. category_id is now the source
-- of truth (the existing 7 rows still carry their old `category` text from
-- before 0021 ran), so `category` simply becomes optional rather than
-- being backfilled or dropped outright.
alter table file_repository alter column category drop not null;
