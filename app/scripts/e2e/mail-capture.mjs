import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const host = process.env.MAIL_CAPTURE_HOST || "127.0.0.1";
const httpPort = Number(process.env.MAIL_CAPTURE_PORT || "8025");
const mailboxFile =
  process.env.MAIL_CAPTURE_FILE || path.join(process.cwd(), "node_modules", ".cache", "e2e", "mailbox.json");

function ensureMailboxDir() {
  mkdirSync(path.dirname(mailboxFile), { recursive: true });
}

function readMailbox() {
  if (!existsSync(mailboxFile)) {
    return [];
  }

  try {
    return JSON.parse(readFileSync(mailboxFile, "utf8"));
  } catch {
    return [];
  }
}

function writeMailbox(messages) {
  ensureMailboxDir();
  writeFileSync(mailboxFile, JSON.stringify(messages, null, 2));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function normalizeRecipient(recipient = "") {
  return recipient.trim().toLowerCase();
}

const httpServer = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/reset") {
    writeMailbox([]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/messages") {
    sendJson(response, 200, { items: readMailbox() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/messages/latest") {
    const recipient = normalizeRecipient(url.searchParams.get("recipient") || "");
    const messages = readMailbox()
      .filter((message) => {
        if (!recipient) {
          return true;
        }

        return message.recipients.includes(recipient);
      })
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));

    sendJson(response, 200, {
      item: messages[0] ?? null,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/messages") {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    request.on("end", () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const raw = [
          `From: ${payload.from}`,
          `To: ${payload.to}`,
          `Subject: ${payload.subject}`,
          "",
          payload.text,
        ]
          .join("\n")
          .trim();
        const messages = readMailbox();
        messages.push({
          from: payload.from,
          raw,
          receivedAt: new Date().toISOString(),
          recipients: [normalizeRecipient(payload.to)],
          subject: payload.subject,
          text: payload.text,
          to: payload.to,
        });
        writeMailbox(messages);
        sendJson(response, 200, { ok: true });
      } catch {
        sendJson(response, 400, { error: "Invalid message payload" });
      }
    });

    request.on("error", () => {
      sendJson(response, 500, { error: "Failed to read request body" });
    });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

ensureMailboxDir();
writeMailbox([]);

httpServer.listen(httpPort, host, () => {
  console.log(`Mail capture HTTP API listening on http://${host}:${httpPort}`);
});

function shutdown(code = 0) {
  httpServer.close(() => {
    process.exit(code);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
