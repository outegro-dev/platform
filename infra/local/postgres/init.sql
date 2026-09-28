-- One database and one owner role per service (INV-23: a service never
-- touches another service's data). Local passwords only.
CREATE ROLE auth LOGIN PASSWORD 'auth';
CREATE DATABASE auth OWNER auth;
CREATE ROLE notifications LOGIN PASSWORD 'notifications';
CREATE DATABASE notifications OWNER notifications;
CREATE ROLE payments LOGIN PASSWORD 'payments';
CREATE DATABASE payments OWNER payments;
CREATE ROLE admin LOGIN PASSWORD 'admin';
CREATE DATABASE admin OWNER admin;
