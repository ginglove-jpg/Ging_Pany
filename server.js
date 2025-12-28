/**
 * 신년계획서 사이트 (방 링크 공유형)
 * - 보스(주인장)가 로그인 후 방 생성(Start) → 링크 공유
 * - 참가자는 링크에서 로그인 후 1회 작성(삭제하면 이번 사이클 재작성 불가) + 수정 가능
 * - 보스만 종료 버튼 보임: 종료 시 365일 잠금 + 화면에 (일자/시간)만 표시
 * - 365일 지나면 자동으로 새 사이클 오픈(방은 유지, 보스/글/유저 초기화)
 * - 전체 공개 목록(잠금 전)
 */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
require("dotenv").config();

const {
  loadState,
  saveState,
  ensureFreshRoom,
  DEFAULT_THEME,
  newId,
  newRoomId,
  hashPassword,
  safeNickname,
} = require("./src/data_store");

const app = express();
app.set("trust proxy", true);

const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = "sid";

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/public", express.static(path.join(__dirname, "public")));

// ---------- Pages ----------

app.get("/", (req, res) => {
  return res.send(renderAppShell(DEFAULT_THEME));
});

app.get("/r/:roomId", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) {
    return res.status(404).send(renderNotFound("존재하지 않는 링크입니다."));
  }

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) {
    return res.status(404).send(renderNotFound("방을 찾을 수 없습니다. (보스가 만든 링크인지 확인해 주세요)"));
  }
  const room = ensureFreshRoom(st, roomId);

  if (room.status === "locked") {
    // 요구사항: 종료 시각만 표시
    return res.send(renderLocked(room.lockedAt));
  }

  return res.send(renderAppShell(room.theme || DEFAULT_THEME));
});

// ---------- API (Rooms) ----------

app.post("/api/rooms", (req, res) => {
  // 보스가 방 생성(Start). body: { nickname, password }
  const nickname = safeNickname(req.body?.nickname);
  const password = String(req.body?.password || "");
  if (!nickname) return res.status(400).json({ ok: false, error: "bad_nickname" });
  if (password.length < 2 || password.length > 64) return res.status(400).json({ ok: false, error: "bad_password" });

  const st = loadState();
  const roomId = newRoomId();

  const now = new Date().toISOString();
  const room = {
    id: roomId,
    createdAt: now,
    updatedAt: now,
    status: "open",
    bossSessionId: null,
    bossNickname: nickname,
    startedAt: now,
    lockedAt: null,
    unlockAt: null,
    theme: { ...DEFAULT_THEME },
    users: {},
    plans: {},
  };

  // boss user create
  const salt = crypto.randomBytes(16).toString("hex");
  room.users[nickname] = {
    nickname,
    salt,
    passHash: hashPassword(password, salt),
    createdAt: now,
    lastLoginAt: now,
  };

  // session
  const sid = newId(24);
  room.bossSessionId = sid;
  st.sessions[sid] = { roomId, nickname, createdAt: now, lastSeenAt: now };
  st.rooms[roomId] = room;
  saveState(st);

  setSidCookie(res, sid);
  res.json({ ok: true, roomId, url: `/r/${roomId}`, isBoss: true });
});

app.get("/api/rooms/:roomId/status", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);

  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked", lockedAt: room.lockedAt });

  const sid = req.cookies[COOKIE_NAME] || null;
  const session = sid ? st.sessions[sid] : null;
  const me = session && session.roomId === roomId ? { nickname: session.nickname } : null;
  const isBoss = !!sid && room.bossSessionId === sid;

  res.json({
    ok: true,
    room: {
      id: room.id,
      status: room.status,
      bossNickname: room.bossNickname,
      startedAt: room.startedAt,
      theme: room.theme,
    },
    me: {
      loggedIn: !!me,
      nickname: me?.nickname || null,
      isBoss,
    },
  });
});

app.post("/api/rooms/:roomId/login", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const nickname = safeNickname(req.body?.nickname);
  const password = String(req.body?.password || "");
  if (!nickname) return res.status(400).json({ ok: false, error: "bad_nickname" });
  if (password.length < 2 || password.length > 64) return res.status(400).json({ ok: false, error: "bad_password" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked", lockedAt: room.lockedAt });

  const now = new Date().toISOString();
  const u = room.users[nickname];
  if (u) {
    const expect = u.passHash;
    const actual = hashPassword(password, u.salt);
    if (expect !== actual) return res.status(403).json({ ok: false, error: "wrong_password" });
    u.lastLoginAt = now;
    room.users[nickname] = u;
  } else {
    const salt = crypto.randomBytes(16).toString("hex");
    room.users[nickname] = {
      nickname,
      salt,
      passHash: hashPassword(password, salt),
      createdAt: now,
      lastLoginAt: now,
    };
  }

  const sid = newId(24);
  st.sessions[sid] = { roomId, nickname, createdAt: now, lastSeenAt: now };
  room.updatedAt = now;
  st.rooms[roomId] = room;
  saveState(st);

  setSidCookie(res, sid);

  res.json({ ok: true, nickname, isBoss: room.bossSessionId === sid });
});

app.post("/api/rooms/:roomId/start", (req, res) => {
  // 새 사이클에서 'waiting' 상태일 때: 로그인한 사람이 Start를 누르면 보스 지정 + open
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked" });

  const sid = req.cookies[COOKIE_NAME] || null;
  const session = sid ? st.sessions[sid] : null;
  if (!sid || !session || session.roomId !== roomId) return res.status(401).json({ ok: false, error: "login_required" });

  if (room.status !== "waiting") {
    return res.json({ ok: true, status: room.status, isBoss: room.bossSessionId === sid });
  }

  // 보스가 없으면 이 사람이 보스
  if (!room.bossSessionId) {
    const now = new Date().toISOString();
    room.status = "open";
    room.bossSessionId = sid;
    room.bossNickname = session.nickname;
    room.startedAt = now;
    room.updatedAt = now;
    st.rooms[roomId] = room;
    saveState(st);
  }

  res.json({ ok: true, status: room.status, isBoss: room.bossSessionId === sid });
});

// ---------- API (Plans) ----------

app.get("/api/rooms/:roomId/plans", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked", lockedAt: room.lockedAt });
  if (room.status !== "open") return res.json({ ok: true, plans: [] });

  const plans = Object.values(room.plans || {})
    .filter((p) => !p.deletedAt)
    .map((p) => ({
      nickname: p.nickname,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      content: sanitizeContent(p.content),
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  res.json({ ok: true, plans });
});

app.get("/api/rooms/:roomId/me", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked", lockedAt: room.lockedAt });

  const sid = req.cookies[COOKIE_NAME] || null;
  const session = sid ? st.sessions[sid] : null;
  if (!sid || !session || session.roomId !== roomId) return res.json({ ok: true, me: null, plan: null });

  // update lastSeen
  session.lastSeenAt = new Date().toISOString();
  st.sessions[sid] = session;
  saveState(st);

  const rawPlan = room.plans?.[session.nickname] || null;
  const plan = rawPlan
    ? {
        ...rawPlan,
        content: rawPlan.deletedAt ? null : sanitizeContent(rawPlan.content),
      }
    : null;
  res.json({ ok: true, me: { nickname: session.nickname, isBoss: room.bossSessionId === sid }, plan });
});

app.post("/api/rooms/:roomId/plan", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked" });
  if (room.status !== "open") return res.status(409).json({ ok: false, error: "not_started" });

  const sid = req.cookies[COOKIE_NAME] || null;
  const session = sid ? st.sessions[sid] : null;
  if (!sid || !session || session.roomId !== roomId) return res.status(401).json({ ok: false, error: "login_required" });

  const nick = session.nickname;
  const existing = room.plans[nick] || null;
  if (existing && existing.deletedAt) {
    return res.status(409).json({ ok: false, error: "already_used" });
  }

  const now = new Date().toISOString();
  const content = sanitizeContent(req.body?.content);
  if (existing) {
    existing.content = content;
    existing.updatedAt = now;
    room.plans[nick] = existing;
  } else {
    room.plans[nick] = {
      nickname: nick,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      content,
    };
  }

  room.updatedAt = now;
  st.rooms[roomId] = room;
  saveState(st);
  res.json({ ok: true, plan: room.plans[nick] });
});

app.delete("/api/rooms/:roomId/plan", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked" });
  if (room.status !== "open") return res.status(409).json({ ok: false, error: "not_started" });

  const sid = req.cookies[COOKIE_NAME] || null;
  const session = sid ? st.sessions[sid] : null;
  if (!sid || !session || session.roomId !== roomId) return res.status(401).json({ ok: false, error: "login_required" });

  const nick = session.nickname;
  const existing = room.plans[nick];
  if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
  if (existing.deletedAt) return res.status(409).json({ ok: false, error: "already_deleted" });

  const now = new Date().toISOString();
  existing.deletedAt = now;
  existing.updatedAt = now;
  existing.content = null;
  room.plans[nick] = existing;
  room.updatedAt = now;
  st.rooms[roomId] = room;
  saveState(st);

  res.json({ ok: true });
});


// 보스(주인장) 전용: 특정 닉네임의 게시글 삭제 (모더레이션)
app.delete("/api/rooms/:roomId/boss/plan/:nickname", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const targetNick = safeNickname(decodeURIComponent(String(req.params.nickname || "")));
  if (!targetNick) return res.status(400).json({ ok: false, error: "bad_nickname" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked" });
  if (room.status !== "open") return res.status(409).json({ ok: false, error: "not_started" });

  const sid = req.cookies[COOKIE_NAME] || null;
  if (!sid || room.bossSessionId !== sid) return res.status(403).json({ ok: false, error: "forbidden" });

  const existing = room.plans?.[targetNick] || null;
  if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
  if (existing.deletedAt) return res.status(409).json({ ok: false, error: "already_deleted" });

  const now = new Date().toISOString();
  existing.deletedAt = now;
  existing.updatedAt = now;
  existing.content = null;
  room.plans[targetNick] = existing;
  room.updatedAt = now;
  st.rooms[roomId] = room;
  saveState(st);

  res.json({ ok: true });
});
// ---------- API (Boss) ----------

app.post("/api/rooms/:roomId/boss/end", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked" });
  if (room.status !== "open") return res.status(409).json({ ok: false, error: "not_started" });

  const sid = req.cookies[COOKIE_NAME] || null;
  if (!sid || room.bossSessionId !== sid) return res.status(403).json({ ok: false, error: "forbidden" });

  const now = new Date();
  const lockedAt = now.toISOString();
  const unlockAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365).toISOString();

  room.status = "locked";
  room.lockedAt = lockedAt;
  room.unlockAt = unlockAt;
  room.updatedAt = lockedAt;
  st.rooms[roomId] = room;
  saveState(st);

  res.json({ ok: true, lockedAt, unlockAt });
});

app.post("/api/rooms/:roomId/boss/theme", (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[0-9a-f]{10}$/i.test(roomId)) return res.status(404).json({ ok: false, error: "not_found" });

  const st = loadState();
  if (!st.rooms || !st.rooms[roomId]) return res.status(404).json({ ok: false, error: "not_found" });
  const room = ensureFreshRoom(st, roomId);
  if (room.status === "locked") return res.status(423).json({ ok: false, error: "locked" });

  const sid = req.cookies[COOKIE_NAME] || null;
  if (!sid || room.bossSessionId !== sid) return res.status(403).json({ ok: false, error: "forbidden" });

  const next = req.body || {};
  room.theme = {
    ...room.theme,
    title: clampStr(next.title, 2, 40) || room.theme.title,
    subtitle: clampStr(next.subtitle, 0, 80) ?? room.theme.subtitle,
    primary: isHexColor(next.primary) ? next.primary : room.theme.primary,
    bg1: isHexColor(next.bg1) ? next.bg1 : room.theme.bg1,
    bg2: isHexColor(next.bg2) ? next.bg2 : room.theme.bg2,
    cardRadius: clampNum(next.cardRadius, 8, 28, room.theme.cardRadius),
    font: clampStr(next.font, 0, 60) ?? room.theme.font,
  };
  room.updatedAt = new Date().toISOString();
  st.rooms[roomId] = room;
  saveState(st);

  res.json({ ok: true, theme: room.theme });
});

// ---------- Helpers ----------

function setSidCookie(res, sid) {
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 365 * 2,
  });
}

function renderLocked(iso) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>잠금됨</title>
<style>
  body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0f19;color:#fff;font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;}
  .t{font-size:clamp(22px,4vw,40px);letter-spacing:.5px}
</style>
</head>
<body>
  <div class="t">${escapeHtml(formatKST(iso))}</div>
</body>
</html>`;
}

function renderNotFound(msg) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>404</title>
  <style>
    body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0f19;color:#fff;font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;}
    .box{max-width:720px;padding:22px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.06)}
    a{color:#fff}
  </style>
</head>
<body>
  <div class="box">
    <div style="font-size:18px;margin-bottom:10px;">${escapeHtml(msg || "페이지를 찾을 수 없습니다.")}</div>
    <div style="opacity:.8">홈으로: <a href="/">/</a></div>
  </div>
</body>
</html>`;
}

function renderAppShell(theme) {
  const t = {
    title: theme.title || "신년계획서",
    subtitle: theme.subtitle || "보스가 방을 만들고 링크를 공유하면, 참가자들이 로그인 후 계획서를 작성합니다.",
    primary: theme.primary || "#7c3aed",
    bg1: theme.bg1 || "#0b1020",
    bg2: theme.bg2 || "#151a2e",
    cardRadius: Number.isFinite(theme.cardRadius) ? theme.cardRadius : 18,
    font: theme.font || "system-ui, -apple-system, Segoe UI, Roboto, Arial",
  };

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(t.title)}</title>
<link rel="stylesheet" href="/public/app.css" />
<style>
:root{
  --primary:${t.primary};
  --bg1:${t.bg1};
  --bg2:${t.bg2};
  --radius:${t.cardRadius}px;
  --font:${t.font};
}
</style>
</head>
<body>
  <div id="app"></div>
  <script src="/public/app.js"></script>
</body>
</html>`;
}

function sanitizeContent(content) {
  // 한 줄 목표만 저장합니다. (과거 버전 호환: headline → goal)
  let goal = "";
  if (typeof content === "string") {
    goal = content;
  } else if (content && typeof content === "object") {
    if (typeof content.goal === "string") goal = content.goal;
    else if (typeof content.headline === "string") goal = content.headline;
  }

  goal = String(goal || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return { goal };
}

function defaultContent() {
  return { goal: "" };
}

function isHexColor(v) {
  return typeof v === "string" && /^#([0-9a-fA-F]{6})$/.test(v.trim());
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampStr(v, minLen, maxLen) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < minLen) return minLen === 0 ? "" : null;
  if (s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatKST(iso) {
  try {
    const d = new Date(iso);
    const yyyy = d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", year: "numeric" }).slice(0, 4);
    const mm = d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", month: "2-digit" });
    const dd = d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", day: "2-digit" });
    const hh = d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false });
    const mi = d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", minute: "2-digit" });
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return iso;
  }
}

app.listen(PORT, () => {
  console.log(`✅ 신년계획서 서버 실행: http://localhost:${PORT}`);
});
