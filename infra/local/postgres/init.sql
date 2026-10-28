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
CREATE ROLE battleship LOGIN PASSWORD 'battleship';
CREATE DATABASE battleship OWNER battleship;
CREATE ROLE edu LOGIN PASSWORD 'edu';
CREATE DATABASE edu OWNER edu;
CREATE ROLE roulette LOGIN PASSWORD 'roulette';
CREATE DATABASE roulette OWNER roulette;
CREATE ROLE fair_roll LOGIN PASSWORD 'fair_roll';
CREATE DATABASE fair_roll OWNER fair_roll;
CREATE ROLE daily LOGIN PASSWORD 'daily';
CREATE DATABASE daily OWNER daily;
