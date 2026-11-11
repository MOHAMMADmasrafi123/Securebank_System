
import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.ts";

/**
 * Supports both DB_* variables used by the MariaDB driver adapter and
 * DATABASE_URL used by Prisma CLI/migrations.
 * DB_* variables take precedence.
 */
function readDatabaseConfig() {
  let fromUrl = {};
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);

      if (!["mysql:", "mariadb:"].includes(parsed.protocol)) {
        throw new Error(
          "DATABASE_URL must use mysql:// or mariadb://"
        );
      }

      fromUrl = {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 3306,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: decodeURIComponent(
          parsed.pathname.replace(/^\//, "")
        ),
      };
    } catch (error) {
      throw new Error(`Invalid DATABASE_URL: ${error.message}`);
    }
  }

  const config = {
    host: process.env.DB_HOST?.trim() || fromUrl.host || "127.0.0.1",
    port: Number(process.env.DB_PORT || fromUrl.port || 3306),
    user: process.env.DB_USER?.trim() || fromUrl.user,
    password: process.env.DB_PASSWORD ?? fromUrl.password,
    database: process.env.DB_NAME?.trim() || fromUrl.database,
  };

  const missing = ["user", "password", "database"].filter(
    (key) => config[key] === undefined || config[key] === ""
  );

  if (missing.length) {
    throw new Error(
      `MySQL configuration missing: ${missing.join(", ")}. ` +
      "Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME " +
      "or a valid DATABASE_URL in backend/.env."
    );
  }

  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  ) {
    throw new Error(
      "DB_PORT must be a valid port number (normally 3306)."
    );
  }

  return config;
}

const dbConfig = readDatabaseConfig();

const adapter = new PrismaMariaDb({
  ...dbConfig,

  // MySQL caching_sha2_password authentication support
  allowPublicKeyRetrieval: true,

  connectionLimit: Number(
    process.env.DB_CONNECTION_LIMIT || 10
  ),

  connectTimeout: 15000,
  acquireTimeout: 15000,
  idleTimeout: 60000,
});

export const prisma = new PrismaClient({ adapter });
