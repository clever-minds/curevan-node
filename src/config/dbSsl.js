// Optional encrypted database connection, for a remote or managed PostgreSQL that refuses plain connections
// ("no pg_hba.conf entry ... no encryption").
//   DB_SSL=true                       encrypt the connection (the server certificate is not checked)
//   DB_SSL_CA=/path/to/ca-bundle.pem  also check the server certificate against this CA bundle (e.g. the AWS RDS bundle)
// Without DB_SSL nothing changes: the connection stays as it was.
const fs = require("fs");

function sslOptions() {
  if (String(process.env.DB_SSL || "").toLowerCase() !== "true") return null;
  if (process.env.DB_SSL_CA) return { require: true, rejectUnauthorized: true, ca: fs.readFileSync(process.env.DB_SSL_CA, "utf8") };
  return { require: true, rejectUnauthorized: false };
}

module.exports = {
  dialectOptions: () => { const ssl = sslOptions(); return ssl ? { dialectOptions: { ssl } } : {}; },
  pgSsl: () => sslOptions() || undefined,
};
