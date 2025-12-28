const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, "..", "data.json");

const DEFAULT_THEME = {
  title: "신년계획서",
  subtitle: "보스가 방을 만들고 링크를 공유하면, 참가자들이 로그인 후 계획서를 작성합니다.",
  primary: "#7c3aed",
  bg1: "#0b1020",
  bg2: "#151a2e",
  cardRadius: 18,
  font: "system-ui, -apple-system, Segoe UI, Roboto, Arial"
};

function defaultState() {
  return {
    meta: {
      dataVersion: 2,
      createdAt: new Date().toISOString()
    },
    rooms: {},
    sessions: {}
  };
}

function defaultRoom(roomId) {
  const now = new Date().toISOString();
  return {
    id: roomId,
    createdAt: now,
    updatedAt: now,
    status: "waiting", // waiting | open | locked
    bossSessionId: null,
    bossNickname: null,
    startedAt: null,
    lockedAt: null,
    unlockAt: null,
    theme: { ...DEFAULT_THEME },
    users: {},
    plans: {}
  };
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const st = defaultState();
      writeAtomic(DATA_FILE, JSON.stringify(st, null, 2));
      return st;
    }

    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const st = JSON.parse(raw);

    // --- migrate v1 -> v2 (best effort) ---
    if (!st.meta || st.meta.dataVersion !== 2) {
      // v1 구조(cycle/entries)가 있으면 legacy 방으로 옮김
      if (st.cycle || st.entries) {
        const v2 = defaultState();
        const legacyId = "legacy";
        const room = defaultRoom(legacyId);
        room.status = (st.cycle?.status === "locked") ? "locked" : "open";
        room.startedAt = st.cycle?.bossStartedAt || new Date().toISOString();
        room.lockedAt = st.cycle?.lockedAt || null;
        room.unlockAt = st.cycle?.unlockAt || null;
        room.theme = { ...DEFAULT_THEME, ...(st.theme || {}) };

        // IP 기반 entries는 nickname이 없어서 public list로는 의미가 약하지만, 보존만
        // nickname을 ipHash 앞 6자리로 만들어 넣음
        const entries = st.entries || {};
        for (const [ipH, e] of Object.entries(entries)) {
          if (e?.deletedAt) continue;
          const nick = `user_${String(ipH).slice(0, 6)}`;
          room.plans[nick] = {
            nickname: nick,
            createdAt: e.createdAt || room.createdAt,
            updatedAt: e.updatedAt || e.createdAt || room.createdAt,
            deletedAt: null,
            content: e.content || null
          };
        }
        v2.rooms[legacyId] = room;
        writeAtomic(DATA_FILE, JSON.stringify(v2, null, 2));
        return v2;
      }
    }

    // --- v2 보정 ---
    if (!st.meta) st.meta = { dataVersion: 2, createdAt: new Date().toISOString() };
    st.meta.dataVersion = 2;
    if (!st.rooms) st.rooms = {};
    if (!st.sessions) st.sessions = {};

    return st;
  } catch (e) {
    // 파일이 깨졌으면 백업 후 초기화
    try {
      const backup = DATA_FILE.replace(/\.json$/i, "") + `.broken_${Date.now()}.json`;
      fs.copyFileSync(DATA_FILE, backup);
    } catch {}

    const st = defaultState();
    writeAtomic(DATA_FILE, JSON.stringify(st, null, 2));
    return st;
  }
}

function saveState(st) {
  writeAtomic(DATA_FILE, JSON.stringify(st, null, 2));
}

function ensureRoom(st, roomId) {
  if (!st.rooms[roomId]) {
    st.rooms[roomId] = defaultRoom(roomId);
    saveState(st);
  }
  return st.rooms[roomId];
}

function ensureFreshRoom(st, roomId) {
  const room = ensureRoom(st, roomId);
  if (room.status === "locked" && room.unlockAt) {
    const unlock = Date.parse(room.unlockAt);
    if (Number.isFinite(unlock) && Date.now() >= unlock) {
      // 새 사이클: 보스/작성글/유저/세션(해당 room) 초기화
      room.status = "waiting";
      room.bossSessionId = null;
      room.bossNickname = null;
      room.startedAt = null;
      room.lockedAt = null;
      room.unlockAt = null;
      room.users = {};
      room.plans = {};
      room.updatedAt = new Date().toISOString();

      // 세션 정리(해당 room만)
      for (const [sid, s] of Object.entries(st.sessions || {})) {
        if (s?.roomId === roomId) delete st.sessions[sid];
      }

      saveState(st);
    }
  }
  return room;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.ip || "";
}

function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

function newId(bytes = 10) {
  return crypto.randomBytes(bytes).toString("hex");
}

function newRoomId() {
  // 짧고 공유하기 쉬운 형태
  return crypto.randomBytes(5).toString("hex"); // 10 chars
}

function hashPassword(password, salt) {
  const pw = String(password || "");
  const s = String(salt || "");
  return crypto.pbkdf2Sync(pw, s, 120000, 32, "sha256").toString("hex");
}

function safeNickname(nick) {
  if (nick === null || nick === undefined) return null;
  if (typeof nick !== "string") return null;
  const s = nick.trim();
  if (s.length < 2 || s.length > 20) return null;
  // 한글/영문/숫자/공백/_- 만 허용
  if (!/^[0-9A-Za-z가-힣 _\-]+$/.test(s)) return null;
  return s;
}

module.exports = {
  loadState,
  saveState,
  ensureRoom,
  ensureFreshRoom,
  DEFAULT_THEME,
  getClientIp,
  newId,
  newRoomId,
  hashPassword,
  safeNickname
};
