(() => {
  const POSTS_KEY = "threadlet.posts.v2";
  const USERS_KEY = "threadlet.users.v1";
  const SESSION_KEY = "threadlet.session";
  const THEME_KEY = "threadlet.theme";
  const MAX_IMG_SIDE = 1080;   // photos are shrunk to this size to stay "lite"
  const IMG_QUALITY = 0.7;

  const $ = id => document.getElementById(id);
  const feed = $("feed"), empty = $("empty");
  const text = $("postText"), counter = $("counter"), postBtn = $("postBtn");

  let me = null;               // logged-in username
  let pendingImg = null;       // compressed photo waiting to be posted
  const openReplies = new Set();

  // ---------- storage ----------
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }   // usually: storage is full
  }
  function seed() {
    const now = Date.now();
    return [
      { id: 1, user: "mira", text: "Lite apps are underrated. Fast, small, and they work on bad signal.", image: null, time: now - 3600e3, likes: 4, liked: false, reposted: false, replies: [] },
      { id: 2, user: "dev", text: "Shipping the first version today. Short posts only.", image: null, time: now - 7200e3, likes: 1, liked: false, reposted: false, replies: [] },
    ];
  }
  let posts = read(POSTS_KEY, null) || seed();
  function savePosts() {
    if (!write(POSTS_KEY, posts)) {
      alert("Storage is full. Delete a few posts with photos and try again.");
      return false;
    }
    return true;
  }

  // ---------- password hashing ----------
  // PBKDF2 where the browser allows it (HTTPS or localhost).
  // On plain http:// over Wi-Fi the browser hides crypto.subtle, so a weak fallback is used.
  const enc = new TextEncoder();
  const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  function newSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return toHex(a);
  }
  async function hashPassword(pw, saltHex) {
    if (window.crypto && crypto.subtle) {
      const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
      const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
      return toHex(bits);
    }
    let h = 5381;
    const s = saltHex + pw;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return "weak-" + (h >>> 0).toString(16);
  }

  // ---------- auth ----------
  let mode = "login";
  const authUser = $("authUser"), authPass = $("authPass"), authError = $("authError"), authBtn = $("authBtn");

  function setMode(m) {
    mode = m;
    //---------
       $("authEmail").hidden = m !== "signup";
    //----------
    $("tabLogin").classList.toggle("on", m === "login");
    $("tabSignup").classList.toggle("on", m === "signup");
    authBtn.textContent = m === "login" ? "Log in" : "Create account";
    authPass.autocomplete = m === "login" ? "current-password" : "new-password";
    showError("");
  }
  function showError(msg) {
    authError.textContent = msg;
    authError.hidden = !msg;
  }

  async function submitAuth() {
    const username = authUser.value.trim().toLowerCase();
    const password = authPass.value;
    //--------
         const email = $("authEmail").value.trim().toLowerCase();
     if (mode === "signup" && !/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email.");
    //---------

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return showError("Username must be 3–20 letters, numbers or underscores.");
    }
    if (password.length < 6) return showError("Password must be at least 6 characters.");

    authBtn.disabled = true;
    try {
      const users = read(USERS_KEY, {});
      //------
      if (mode === "signup") {
  if (users[username]) return showError("That username is taken.");
  const salt = newSalt();
  users[username] = { salt, hash: await hashPassword(password, salt), email };
  if (!write(USERS_KEY, users)) return showError("Could not save your account. Storage is full.");
}
      //-------
       else {
        const u = users[username];
        if (!u || (await hashPassword(password, u.salt)) !== u.hash) {
          return showError("Wrong username or password.");
        }
      }
      localStorage.setItem(SESSION_KEY, username);
      authUser.value = ""; authPass.value = "";
      showError("");
      enter(username);
    } finally {
      authBtn.disabled = false;
    }
  }

  function enter(username) {
    me = username;
    $("auth").hidden = true;
    $("appView").hidden = false;
    $("whoami").textContent = "@" + me;
    $("whoami").hidden = false;
    $("logoutBtn").hidden = false;
    render();
  }
  function leave() {
    me = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    $("appView").hidden = true;
    $("auth").hidden = false;
    $("whoami").hidden = true;
    $("logoutBtn").hidden = true;
    openReplies.clear();
    clearPhoto();
  }

  $("tabLogin").onclick = () => setMode("login");
  $("tabSignup").onclick = () => setMode("signup");
  authBtn.onclick = submitAuth;
  authPass.onkeydown = e => { if (e.key === "Enter") submitAuth(); };
  authUser.onkeydown = e => { if (e.key === "Enter") authPass.focus(); };
  $("logoutBtn").onclick = leave;

  // ---------- helpers ----------
  function ago(t) {
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  // ---------- render ----------
  function render() {
    feed.replaceChildren();
    empty.hidden = posts.length > 0;
    posts.forEach(p => feed.appendChild(renderPost(p)));
  }

  function renderPost(p) {
    const card = el("article", "post");

    const head = el("div", "post-head");
    head.append(el("span", "name", p.user), el("span", "time", ago(p.time)));
    card.append(head);
    if (p.text) card.append(el("div", "post-body", p.text));

    if (p.image) {
      const img = el("img", "post-img");
      img.src = p.image;
      img.alt = "Photo posted by " + p.user;
      img.loading = "lazy";
      card.append(img);
    }

    const bar = el("div", "actions");

    const like = el("button", "act like" + (p.liked ? " on" : ""), (p.liked ? "♥ " : "♡ ") + p.likes);
    like.onclick = () => { p.liked = !p.liked; p.likes += p.liked ? 1 : -1; savePosts(); render(); };

    const reply = el("button", "act", "💬 " + p.replies.length);
    reply.onclick = () => {
      openReplies.has(p.id) ? openReplies.delete(p.id) : openReplies.add(p.id);
      render();
    };

    const repost = el("button", "act repost" + (p.reposted ? " on" : ""), "⟳ " + (p.reposted ? "Reposted" : "Repost"));
    repost.onclick = () => { p.reposted = !p.reposted; savePosts(); render(); };

    bar.append(like, reply, repost);

    if (p.user === me) {
      const del = el("button", "act del", "Delete");
      del.onclick = () => {
        if (!confirm("Delete this thread?")) return;
        posts = posts.filter(x => x.id !== p.id); savePosts(); render();
      };
      bar.append(del);
    }
    card.append(bar);

    if (openReplies.has(p.id)) card.append(renderReplies(p));
    return card;
  }

  function renderReplies(p) {
    const box = el("div", "replies");
    p.replies.forEach(r => {
      const row = el("div", "reply");
      const h = el("div", "post-head");
      h.append(el("span", "name", r.user), el("span", "time", ago(r.time)));
      row.append(h, el("div", "post-body", r.text));
      box.append(row);
    });

    const form = el("div", "reply-form");
    const input = el("input", "reply-input");
    input.placeholder = "Reply…";
    input.maxLength = 300;
    const send = el("button", "primary", "Reply");
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      p.replies.push({ id: Date.now(), user: me, text: v, time: Date.now() });
      savePosts(); render();
    };
    send.onclick = submit;
    input.onkeydown = e => { if (e.key === "Enter") submit(); };
    form.append(input, send);
    box.append(form);
    return box;
  }

  // ---------- photos ----------
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_SIDE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";            // white behind transparent PNGs
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", IMG_QUALITY));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  function clearPhoto() {
    pendingImg = null;
    $("photoInput").value = "";
    $("previewWrap").hidden = true;
    $("preview").removeAttribute("src");
    updatePostBtn();
  }

  $("photoBtn").onclick = () => $("photoInput").click();
  $("photoInput").addEventListener("change", async () => {
    const file = $("photoInput").files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please choose an image file.");
    try {
      pendingImg = await compressImage(file);
      $("preview").src = pendingImg;
      $("previewWrap").hidden = false;
      updatePostBtn();
    } catch (e) {
      alert("Could not read that image. Try a different one.");
      clearPhoto();
    }
  });
  $("removeImg").onclick = clearPhoto;

  // ---------- compose ----------
  function updatePostBtn() {
    postBtn.disabled = text.value.trim().length === 0 && !pendingImg;
  }
  text.addEventListener("input", () => {
    counter.textContent = 500 - text.value.length;
    updatePostBtn();
  });
  postBtn.addEventListener("click", () => {
    const v = text.value.trim();
    if (!v && !pendingImg) return;
    const post = {
      id: Date.now(), user: me, text: v, image: pendingImg, time: Date.now(),
      likes: 0, liked: false, reposted: false, replies: [],
    };
    posts.unshift(post);
    if (!savePosts()) { posts.shift(); return; }   // keep the draft if saving failed
    text.value = ""; counter.textContent = "500";
    clearPhoto();
    render();
  });
  
    // ---------- backup / restore ----------
  
  const b64 = bytes => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  const backupMsg = m => { $("backupMsg").textContent = m; };

  async function deriveKey(pass, salt) {
    if (!(window.crypto && crypto.subtle)) throw new Error("Encryption needs HTTPS or localhost.");
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function buildBackup() {
    const data = { app: "threadlet", version: 1, created: new Date().toISOString(),
                   users: read(USERS_KEY, {}), posts };
    const json = JSON.stringify(data);
    const pass = $("backupPass").value;
    if (!pass) return json;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(json));
    return JSON.stringify({ app: "threadlet", encrypted: true,
                            salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) });
  }

  $("backupBtn").onclick = async () => {
    try {
      const blob = new Blob([await buildBackup()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "threadlet-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      backupMsg("Backup saved to your Downloads. Move it somewhere safe, then delete it from Downloads.");
    } catch (e) { backupMsg(e.message || "Backup failed."); }
  };

  $("copyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(await buildBackup());
      backupMsg("Backup copied. Paste it somewhere private, then clear your clipboard.");
    } catch (e) { backupMsg("Could not copy. Use Download backup instead."); }
  };

  $("restoreBtn").onclick = () => $("restoreInput").click();
  $("restoreInput").addEventListener("change", async () => {
    const file = $("restoreInput").files[0];
    $("restoreInput").value = "";
    if (!file) return;
    try {
      let data = JSON.parse(await file.text());
      if (data.app !== "threadlet") throw new Error("This is not a Threadlet backup.");
      if (data.encrypted) {
        const pass = $("backupPass").value;
        if (!pass) throw new Error("Type the passphrase above, then choose the file again.");
        const key = await deriveKey(pass, unb64(data.salt));
        let plain;
        try {
          plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(data.iv) }, key, unb64(data.data));
        } catch (e) { throw new Error("Wrong passphrase, or the file was changed."); }
        data = JSON.parse(new TextDecoder().decode(plain));
      }
      if (!data.users || typeof data.users !== "object" || !Array.isArray(data.posts)) {
        throw new Error("The backup file is damaged.");
      }
      if (!confirm("Restore this backup? It replaces the posts on this device.")) return;
      const merged = Object.assign({}, read(USERS_KEY, {}), data.users);
      if (!write(USERS_KEY, merged) || !write(POSTS_KEY, data.posts)) throw new Error("Storage is full.");
      location.reload();
    } catch (e) { backupMsg(e.message || "Restore failed."); }
  });

  // ---------- theme ----------
  const root = document.documentElement;
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t) root.dataset.theme = t;
  } catch (e) {}
  $("themeBtn").addEventListener("click", () => {
    const dark = root.dataset.theme === "dark" ||
      (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch (e) {}
  });

  // ---------- PWA (only if sw.js is present) ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // ---------- start ----------
  const saved = (() => { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } })();
  const users = read(USERS_KEY, {});
  if (saved && users[saved]) enter(saved);
  else { $("auth").hidden = false; setMode("signup"); }
})();
