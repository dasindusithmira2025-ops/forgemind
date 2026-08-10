CREATE TABLE streams (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL UNIQUE
);

CREATE TABLE events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  stream_id BIGINT NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_events_stream
    FOREIGN KEY (stream_id) REFERENCES streams(id)
);

CREATE INDEX events_stream_created_idx
  ON events (stream_id, created_at);
