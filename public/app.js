(async function () {
  const el = document.getElementById("app");

  function h(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (v === false || v === null || v === undefined) continue;
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      if (typeof c === "string") e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    }
    return e;
  }

  async function api(path, opts) {
    const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
    const txt = await res.text();
    let data = null;
    try {
      data = JSON.parse(txt);
    } catch {
      data = { ok: false, raw: txt };
    }
    if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { status: res.status, data });
    return data;
  }

  function toast(msg) {
    alert(msg);
  }

  function kst(iso) {
    if (!iso) return "";
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
  }// ✅ [추가] 종료 후 남은 시간 표시용 유틸
function addOneYearISO(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

function formatRemain(ms) {
  if (ms <= 0) return "0일 00시간 00분 00초";
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  const p2 = (n) => String(n).padStart(2, "0");
  return `${days}일 ${p2(hours)}시간 ${p2(mins)}분 ${p2(secs)}초`;
}

function remainUntil(iso) {
  if (!iso) return "(알 수 없음)";
  const target = new Date(iso).getTime();
  const now = Date.now();
  return formatRemain(target - now);
}

  function roomIdFromPath() {
    const m = location.pathname.match(/^\/r\/([0-9a-f]{10})$/i);
    return m ? m[1] : null;
  }

  const state = {
    roomId: roomIdFromPath(),
    status: null,
    me: null,
    myPlan: null,
    plans: [],
    themeOpen: false,
    expand: {},
  };

  // ---------- HOME ----------
  async function renderHome() {
    el.innerHTML = "";
    el.appendChild(
      h("div", { class: "container" }, [
        h("div", { class: "header" }, [
          h("div", { class: "brand" }, [
            h("div", { class: "logo" }),
            h("div", { class: "hgroup" }, [
              h("h1", {}, ["신년계획서 (방 링크 공유형)"]),
              h("p", {}, ["보스가 방을 만들고 링크를 공유하면, 참가자들이 로그인 후 작성합니다."]),
            ]),
          ]),
          h("div", { class: "pills" }, [h("div", { class: "pill" }, ["링크로 참가" ])]),
        ]),

        h("div", { class: "card" }, [
          h("div", { class: "inner hero" }, [
            h("div", {}, [
              h("div", { class: "notice" }, [
                h("div", { class: "badge" }, ["설명"]),
                h("div", {}, [
                  h("div", {}, ["• 보스가 닉네임/비번으로 로그인 후 Start(방 생성)"]),
                  h("div", {}, ["• 생성된 링크를 공유하면, 참가자가 같은 링크로 로그인 후 작성"]),
                  h("div", {}, ["• 보스만 종료 가능: 종료하면 365일 잠금 + 화면에 종료 시각만 표시"]),
                ]),
              ]),
              h("div", { class: "hr" }),
              h("div", { class: "big" }, ["1) 닉네임/비번 입력 → 2) Start(방 생성) → 3) 링크 공유"]),
            ]),
            h("div", {}, [
              h("div", { class: "field" }, [
                h("label", {}, ["보스 닉네임 (2~20자)"]),
                h("input", { id: "home_nick", type: "text", placeholder: "예) 주인장" }),
              ]),
              h("div", { class: "field", style: "margin-top:10px" }, [
                h("label", {}, ["보스 비번 (2~64자)"]),
                h("input", { id: "home_pw", type: "password", placeholder: "간단 비밀번호" }),
              ]),
              h("div", { class: "btnrow", style: "margin-top:12px" }, [
                h("button", { class: "primary", onclick: onCreateRoom }, ["Start (방 생성)"]),
              ]),
              h("div", { class: "small", style: "margin-top:10px;opacity:.75" }, [
                "※ 참가자는 보스가 공유한 링크(/r/XXXXXXXXXX)로 접속하면 됩니다.",
              ]),
            ]),
          ]),
        ]),
      ])
    );
  }

  async function onCreateRoom() {
    try {
      const nickname = val("home_nick");
      const password = val("home_pw");
      const r = await api("/api/rooms", { method: "POST", body: JSON.stringify({ nickname, password }) });
      location.href = r.url;
    } catch (e) {
      toast("방 생성 실패: " + (e.data?.error || e.message));
    }
  }

  // ---------- ROOM ----------
  async function loadRoom() {
    state.status = await api(`/api/rooms/${state.roomId}/status`);
    state.me = (await api(`/api/rooms/${state.roomId}/me`)).me;
    state.myPlan = (await api(`/api/rooms/${state.roomId}/me`)).plan;
    // NOTE: /me를 2번 호출하지 않도록 아래에서 한번만 호출
  }

  async function loadAll() {
    // status
    state.status = await api(`/api/rooms/${state.roomId}/status`);
    // me + plan
    const meRes = await api(`/api/rooms/${state.roomId}/me`);
    state.me = meRes.me;
    state.myPlan = meRes.plan;
    // plans
    const pRes = await api(`/api/rooms/${state.roomId}/plans`);
    state.plans = pRes.plans || [];
    renderRoom();
  }

  function renderRoom() {
    const t = state.status.room.theme || {};
    const room = state.status.room;

    el.innerHTML = "";
    el.appendChild(
      h("div", { class: "container" }, [
        h("div", { class: "header" }, [
          h("div", { class: "brand" }, [
            h("div", { class: "logo" }),
            h("div", { class: "hgroup" }, [
              h("h1", {}, [t.title || "신년계획서"]),
              h("p", {}, [t.subtitle || "보스 링크 공유형"]),
            ]),
          ]),
          h("div", { class: "pills" }, [
            h("div", { class: "pill" }, [`방: ${room.id}`]),
            h("div", { class: "pill" }, [room.status === "waiting" ? "시작 전" : "진행 중"]),
            h("div", { class: "pill" }, [room.bossNickname ? `보스: ${room.bossNickname}` : "보스: -"]),
            h("div", { class: "pill" }, [state.me?.nickname ? `내 닉네임: ${state.me.nickname}` : "미로그인"]),
          ]),
        ]),

        h("div", { class: "card" }, [
          h("div", { class: "inner hero" }, [
            h("div", {}, [
              h("div", { class: "notice" }, [
                h("div", { class: "badge" }, ["규칙"]),
                h("div", {}, [
                  h("div", {}, ["• 닉네임당 1회 작성 (삭제해도 이번 사이클 재작성 불가)"]),
                  h("div", {}, ["• 한 줄 목표만 작성 (예: 이번년도엔 운동을 열심히 하겠다)"]),
                  h("div", {}, ["• 수정/삭제는 보스가 종료하기 전까지 가능 (보스는 작성글 삭제 가능)"]),
                  h("div", {}, ["• 보스가 종료하면 365일 잠금 + 화면에 종료 시각만 표시"]),
                ]),
              ]),
              h("div", { class: "hr" }),
              h("div", { class: "big" }, [
                room.status === "waiting"
                  ? "아직 시작 전입니다. 로그인 후 'Start'를 누른 사람이 보스가 됩니다."
                  : "전체 공개 목록에 모두 표시됩니다. (잠금 전까지)",
              ]),
              h("div", { class: "small", style: "margin-top:10px;opacity:.75" }, [
                `공유 링크: ${location.origin}/r/${room.id}`,
              ]),
            ]),

            h("div", {}, [
              h("div", { class: "btnrow" }, [
                state.me?.nickname
                  ? h("button", { onclick: copyLink }, ["링크 복사"])
                  : h("button", { onclick: copyLink }, ["링크 복사"]),
                state.me?.nickname && room.status === "waiting"
                  ? h("button", { class: "primary", onclick: onRoomStart }, ["Start (보스 시작)"])
                  : null,
                state.me?.isBoss ? h("button", { onclick: openTheme }, ["꾸미기(테마)"])
                : null,
                state.me?.isBoss ? h("button", { class: "danger", onclick: onEnd }, ["종료(365일 잠금)"])
                : null,
              ]),
              h("div", { class: "small", style: "margin-top:10px;opacity:.75" }, [
                state.me?.isBoss ? "※ 종료 버튼은 보스에게만 보입니다." : "",
              ]),
            ]),
          ]),
        ]),

        h("div", { class: "grid" }, [
          renderLoginOrFormCard(),
          renderPublicListCard(),
        ]),

        renderThemeModal(),
      ])
    );
  }

  function renderLoginOrFormCard() {
    const room = state.status.room;
    const me = state.me;

    if (!me?.nickname) {
      return h("div", { class: "card" }, [
        h("div", { class: "inner" }, [
          h("div", { class: "badge" }, ["로그인 / 가입"]),
          h("div", { class: "hr" }),
          h("div", { class: "field" }, [
            h("label", {}, ["닉네임 (2~20자)"]),
            h("input", { id: "login_nick", type: "text", placeholder: "예) 태흔" }),
          ]),
          h("div", { class: "field", style: "margin-top:10px" }, [
            h("label", {}, ["비번 (2~64자)"]),
            h("input", { id: "login_pw", type: "password", placeholder: "간단 비밀번호" }),
          ]),
          h("div", { class: "btnrow", style: "margin-top:12px" }, [
            h("button", { class: "primary", onclick: onLogin }, ["로그인 / 가입"]),
          ]),
          h("div", { class: "small", style: "margin-top:10px;opacity:.75" }, [
            "※ 닉네임이 이미 있으면 비번 확인 후 로그인됩니다.",
          ]),
        ]),
      ]);
    }

    // logged in
    if (room.status !== "open") {
      return h("div", { class: "card" }, [
        h("div", { class: "inner" }, [
          h("div", { class: "badge" }, ["내 계획서"]),
          h("div", { class: "hr" }),
          h("div", { class: "notice" }, [
            h("div", { class: "badge" }, ["대기"]),
            h("div", {}, ["아직 시작 전입니다. 보스가 Start하면 작성 가능합니다."]),
          ]),
        ]),
      ]);
    }

    const lockedByRule = !!state.myPlan?.deletedAt;
    const canEdit = !lockedByRule;
    const content = state.myPlan?.content ? state.myPlan.content : defaultContent();

    const card = h("div", { class: "card" }, [
      h("div", { class: "inner" }, [
        h("div", { class: "badge" }, ["내 계획서 작성"]),
        h("div", { class: "hr" }),
        field("한 줄 목표", "f_goal", (content.goal || content.headline || ""), "예) 이번년도엔 운동을 열심히 하겠다"),
        h("div", { class: "hr" }),
        h("div", { class: "btnrow" }, [
          h(
            "button",
            { class: "primary", onclick: onSave, disabled: !canEdit },
            [state.myPlan && !state.myPlan.deletedAt ? "수정 저장" : "작성 저장"]
          ),
          h(
            "button",
            { class: "danger", onclick: onDelete, disabled: !(state.myPlan && !state.myPlan.deletedAt) },
            ["삭제"]
          ),
        ]),
        lockedByRule
          ? h("div", { class: "small", style: "margin-top:10px;opacity:.75" }, [
              "이번 사이클에서 이미 삭제했기 때문에 재작성/수정이 불가능합니다.",
            ])
          : null,
      ]),
    ]);

    setTimeout(() => {
      if (!canEdit) {
        for (const id of [
          "f_goal",
        ]) {
          const e = document.getElementById(id);
          if (e) e.disabled = true;
        }
      }
    }, 0);

    return card;
  }

  function renderPublicListCard() {
    const room = state.status.room;
    if (room.status !== "open") {
      return h("div", { class: "card" }, [
        h("div", { class: "inner" }, [
          h("div", { class: "badge" }, ["전체 공개 목록"]),
          h("div", { class: "hr" }),
          h("div", { class: "notice" }, [
            h("div", { class: "badge" }, ["대기"]),
            h("div", {}, ["방이 시작되면 작성글이 여기 전체 공개로 표시됩니다."]),
          ]),
        ]),
      ]);
    }

    const plans = state.plans || [];
    return h("div", { class: "card" }, [
      h("div", { class: "inner" }, [
        h("div", { class: "badge" }, ["전체 공개 목록"]),
        h("div", { class: "small", style: "margin-top:6px;opacity:.8" }, [
          `총 ${plans.length}명`,
        ]),
        h("div", { class: "hr" }),
        plans.length === 0
          ? h("div", { class: "notice" }, [
              h("div", { class: "badge" }, ["비어있음"]),
              h("div", {}, ["아직 작성한 사람이 없습니다."]),
            ])
          : h(
              "div",
              { class: "plist" },
              plans.map((p) => renderPlanItem(p))
            ),
      ]),
    ]);
  }

  
function renderPlanItem(p) {
  const goal = ((p.content && (p.content.goal || p.content.headline)) || "").trim();

  return h("div", { class: "pitem" }, [
    h("div", { class: "ptop" }, [
      h("div", { class: "pmeta" }, [
        h("div", { class: "pnick" }, [p.nickname]),
        h("div", { class: "ptime" }, [`업데이트: ${kst(p.updatedAt)}`]),
      ]),
      state.me?.isBoss
        ? h("button", { class: "pbtn", onclick: () => onBossDelete(p.nickname) }, ["삭제"])
        : null,
    ]),
    goal
      ? h("div", { class: "psum" }, [goal])
      : h("div", { class: "psum", style: "opacity:.65" }, ["(목표 없음)"]),
  ]);
}

function field(label, id, value, placeholder = "") {
    return h("div", { class: "field" }, [
      h("label", {}, [label]),
      h("input", { type: "text", id, value, placeholder }),
    ]);
  }

  function fieldArea(label, id, value, placeholder = "") {
    return h("div", { class: "field", style: "margin-top:12px" }, [
      h("label", {}, [label]),
      h("textarea", { id, placeholder }, [value]),
    ]);
  }

  function defaultContent() {
    return { goal: "" };
  }

  async function onLogin() {
    try {
      const nickname = val("login_nick");
      const password = val("login_pw");
      await api(`/api/rooms/${state.roomId}/login`, {
        method: "POST",
        body: JSON.stringify({ nickname, password }),
      });
      await loadAll();
      toast("로그인 완료!");
    } catch (e) {
      const code = e.data?.error || e.message;
      if (code === "wrong_password") toast("비밀번호가 틀렸습니다.");
      else toast("로그인 실패: " + code);
    }
  }

  async function onRoomStart() {
    try {
      const r = await api(`/api/rooms/${state.roomId}/start`, { method: "POST", body: "{}" });
      await loadAll();
      if (r.isBoss) toast("당신이 보스(주인장)입니다!");
      else toast("이미 보스가 있습니다.");
    } catch (e) {
      toast("Start 실패: " + (e.data?.error || e.message));
    }
  }

  async function onSave() {
    try {
      const content = {
        goal: val("f_goal"),
      };
      await api(`/api/rooms/${state.roomId}/plan`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      await loadAll();
      toast("저장 완료!");
    } catch (e) {
      const code = e.data?.error || e.message;
      if (code === "already_used") toast("이미 1회 사용(삭제 포함)했습니다. 다음 오픈(1년 뒤)에 다시 작성할 수 있어요.");
      else if (code === "not_started") toast("방이 아직 시작 전입니다. 보스가 Start해야 합니다.");
      else toast("저장 실패: " + code);
    }
  }

  async function onDelete() {
    if (!confirm("삭제하면 이번 사이클에서는 다시 작성할 수 없어요. 정말 삭제할까요?")) return;
    try {
      await api(`/api/rooms/${state.roomId}/plan`, { method: "DELETE" });
      await loadAll();
      toast("삭제 완료!");
    } catch (e) {
      toast("삭제 실패: " + (e.data?.error || e.message));
    }
  }


  async function onBossDelete(nickname) {
    if (!state.me?.isBoss) return;
    if (!confirm(`보스 권한으로 '${nickname}' 글을 삭제할까요?\n삭제되면 이번 사이클에서는 다시 작성할 수 없습니다.`)) return;
    try {
      await api(`/api/rooms/${state.roomId}/boss/plan/${encodeURIComponent(nickname)}`, { method: "DELETE" });
      await loadAll();
      toast("삭제 완료!");
    } catch (e) {
      toast("보스 삭제 실패: " + (e.data?.error || e.message));
    }
  }

 async function onEnd() {
  if (!confirm("종료하면 365일 동안 글쓰기/수정/삭제가 잠깁니다.\n정말 종료할까요?")) return;
  try {
    const r = await api(`/api/rooms/${state.roomId}/boss/end`, { method: "POST", body: "{}" });

    const lockedAt = r.lockedAt;
    const unlockAt = r.unlockAt || addOneYearISO(lockedAt);

    toast(
      "종료 완료!\n" +
      "잠금 시각: " + kst(lockedAt) + "\n" +
      "열람 가능: " + kst(unlockAt) + "\n" +
      "남은 시간: " + remainUntil(unlockAt)
    );

    location.reload();
  } catch (e) {
    toast("종료 실패: " + (e.data?.error || e.message));
  }
}

  function copyLink() {
    const url = `${location.origin}/r/${state.roomId}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast("링크 복사 완료!"))
      .catch(() => toast("복사 실패. 주소를 직접 복사해 주세요: " + url));
  }

  // ----- theme modal -----
  function renderThemeModal() {
    if (!state.me?.isBoss) return h("div", { class: "modal", id: "themeModal" }, []);

    const t = state.status.room.theme || {};
    const modal = h(
      "div",
      { class: "modal", id: "themeModal", onclick: (ev) => { if (ev.target.id === "themeModal") closeTheme(); } },
      [
        h("div", { class: "box" }, [
          h("div", { class: "inner" }, [
            h("h3", {}, ["테마(꾸미기)"]),
            h("div", { class: "row" }, [
              field("사이트 제목", "th_title", t.title || ""),
              field("부제목", "th_subtitle", t.subtitle || ""),
            ]),
            h("div", { class: "row", style: "margin-top:10px" }, [
              field("메인 색상(#RRGGBB)", "th_primary", t.primary || "#7c3aed"),
              field("배경1(#RRGGBB)", "th_bg1", t.bg1 || "#0b1020"),
            ]),
            h("div", { class: "row", style: "margin-top:10px" }, [
              field("배경2(#RRGGBB)", "th_bg2", t.bg2 || "#151a2e"),
              field("폰트(CSS font-family)", "th_font", t.font || "system-ui, -apple-system, Segoe UI, Roboto, Arial"),
            ]),
            h("div", { class: "row", style: "margin-top:10px" }, [
              field("카드 라운드(8~28)", "th_radius", String(t.cardRadius ?? 18)),
              h("div", { class: "field" }, [
                h("label", {}, ["안내"]),
                h("div", { class: "notice" }, [
                  h("div", { class: "badge" }, ["OK"]),
                  h("div", {}, ["저장하면 즉시 반영됩니다."]),
                ]),
              ]),
            ]),
            h("div", { class: "hr" }),
            h("div", { class: "btnrow" }, [
              h("button", { onclick: closeTheme }, ["닫기"]),
              h("button", { class: "primary", onclick: saveTheme }, ["저장"]),
            ]),
            h("div", { class: "small", style: "margin-top:10px;opacity:.75" }, ["색상은 #RRGGBB 형식만 허용됩니다."]),
          ]),
        ]),
      ]
    );

    setTimeout(() => {
      const m = document.getElementById("themeModal");
      if (m) m.classList.toggle("open", state.themeOpen);
    }, 0);

    return modal;
  }

  function openTheme() {
    state.themeOpen = true;
    const m = document.getElementById("themeModal");
    if (m) m.classList.add("open");
  }

  function closeTheme() {
    state.themeOpen = false;
    const m = document.getElementById("themeModal");
    if (m) m.classList.remove("open");
  }

  async function saveTheme() {
    try {
      const payload = {
        title: val("th_title"),
        subtitle: val("th_subtitle"),
        primary: val("th_primary"),
        bg1: val("th_bg1"),
        bg2: val("th_bg2"),
        font: val("th_font"),
        cardRadius: Number(val("th_radius")),
      };
      await api(`/api/rooms/${state.roomId}/boss/theme`, { method: "POST", body: JSON.stringify(payload) });
      closeTheme();
      await loadAll();
      toast("테마 저장 완료!");
    } catch (e) {
      toast("테마 저장 실패: " + (e.data?.error || e.message));
    }
  }

  function val(id) {
    const e = document.getElementById(id);
    return e ? e.value : "";
  }

  // ---------- boot ----------
  try {
    if (!state.roomId) {
      await renderHome();
    } else {
      await loadAll();
    }
  } catch (e) {
    el.innerHTML = "";
    el.appendChild(
      h("div", { class: "container" }, [
        h("div", { class: "card" }, [
          h("div", { class: "inner" }, [
            h("div", { class: "notice" }, [
              h("div", { class: "badge" }, ["오류"]),
              h("div", {}, ["불러오기 실패: " + (e.data?.error || e.message)]),
            ]),
            h("div", { class: "hr" }),
            h("div", { class: "btnrow" }, [
              h("button", { onclick: () => location.href = "/" }, ["홈으로"]),
              h("button", { class: "primary", onclick: () => location.reload() }, ["새로고침"]),
            ]),
          ]),
        ]),
      ])
    );
  }
})();
