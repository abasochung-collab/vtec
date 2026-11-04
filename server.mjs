/* ============================================================================
   baogia.vtec.food — máy chủ một tệp, không phụ thuộc gói ngoài.
   /          trang báo giá (nội dung đã sửa nhét sẵn vào window.NOIDUNG)
   /cai-dat   cùng trang nhưng bật bộ sửa (sau khi nhập mật khẩu)
   /media/*   tệp mặc định (public/media) + tệp đã tải lên (du-lieu/media)
   /api/*     lưu nội dung, nhận tệp, nhận khách để lại số
   ============================================================================ */
import http from "node:http";
import https from "node:https";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync, createWriteStream, appendFileSync, unlinkSync, createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.dirname(fileURLToPath(import.meta.url));
const DL = path.join(GOC, "du-lieu");
mkdirSync(path.join(DL, "media"), { recursive: true });

// .env: PORT, MATKHAU, BIMAT
const env = {};
if (existsSync(path.join(GOC, ".env")))
  for (const d of readFileSync(path.join(GOC, ".env"), "utf8").split("\n")) {
    const m = d.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
  }
const PORT = +(env.PORT || 3077);
const MATKHAU = env.MATKHAU || "";
const BIMAT = env.BIMAT || "";
if (!MATKHAU || !BIMAT) { console.error("Thiếu MATKHAU/BIMAT trong .env"); process.exit(1); }

const kyPhien = (hetHan) => hetHan + "." + createHmac("sha256", BIMAT).update(String(hetHan)).digest("hex");
const phienOk = (cookie) => {
  const m = /(?:^|;\s*)phien=([0-9]+)\.([0-9a-f]{64})/.exec(cookie || ""); if (!m) return false;
  if (+m[1] < Date.now()) return false;
  const dung = createHmac("sha256", BIMAT).update(m[1]).digest("hex");
  try { return timingSafeEqual(Buffer.from(m[2]), Buffer.from(dung)); } catch { return false; }
};
const soSanhMK = (thu) => {
  const a = Buffer.from(String(thu)), b = Buffer.from(MATKHAU);
  return a.length === b.length && timingSafeEqual(a, b);
};

const MIME = { html:"text/html; charset=utf-8", webp:"image/webp", jpg:"image/jpeg", jpeg:"image/jpeg",
  png:"image/png", svg:"image/svg+xml", mp4:"video/mp4", webm:"video/webm", mov:"video/quicktime",
  json:"application/json; charset=utf-8", ico:"image/x-icon" };
const guiTep = (res, tep) => {
  const duoi = tep.split(".").pop().toLowerCase();
  const st = statSync(tep);
  res.writeHead(200, { "Content-Type": MIME[duoi] || "application/octet-stream",
    "Content-Length": st.size, "Cache-Control": "public, max-age=3600" });
  createReadStream(tep).pipe(res);
};
const docThan = (req, max = 1024 * 1024) => new Promise((ok, loi) => {
  let n = 0; const phan = [];
  req.on("data", (c) => { n += c.length; if (n > max) { loi(new Error("to-qua")); req.destroy(); } else phan.push(c); });
  req.on("end", () => ok(Buffer.concat(phan))); req.on("error", loi);
});
// Tải một tệp qua HTTPS (dùng cho tự cập nhật từ GitHub công khai), theo chuyển hướng.
const taiGit = (url, lan = 0) => new Promise((ok, loi) => {
  if (lan > 4) return loi(new Error("Chuyển hướng quá nhiều"));
  https.get(url, { headers: { "User-Agent": "baogia-vtec-selfupdate" } }, (r) => {
    if ([301, 302, 307, 308].includes(r.statusCode) && r.headers.location) { r.resume(); return taiGit(r.headers.location, lan + 1).then(ok, loi); }
    if (r.statusCode !== 200) { r.resume(); return loi(new Error("GitHub trả " + r.statusCode)); }
    const ch = []; r.on("data", (c) => ch.push(c)); r.on("end", () => ok(Buffer.concat(ch)));
  }).on("error", loi);
});
// Kho GitHub công khai để tự cập nhật trang (có thể đổi nhánh qua .env GH_NHANH)
const GH_REPO = "abasochung-collab/vtec";
// Các trang tĩnh trong public/ được phép tự cập nhật từ GitHub. dau = chuỗi bắt buộc để kiểm hợp lệ.
const TRANG_CAP_NHAT = [
  { ten: "trang.html", dau: "<!--NOIDUNG-->" },
  { ten: "1.html", dau: "<!doctype html" },
  { ten: "2.html", dau: "<!doctype html" },
];
const trang = (cheDo) => {
  let s = readFileSync(path.join(GOC, "public", "trang.html"), "utf8");
  let nd = { chu: {}, media: {} };
  const tepND = path.join(DL, "noidung.json");
  if (existsSync(tepND)) { try { nd = JSON.parse(readFileSync(tepND, "utf8")); } catch {} }
  return s.replace("<!--NOIDUNG-->", `<script>window.NOIDUNG=${JSON.stringify(nd)};</script>`)
          .replace("<!--CHEDO-->", `<script>window.CHE_DO=${JSON.stringify(cheDo)};</script>`);
};
const trangDangNhap = (sai) => `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Cài đặt bảng giá VTEC</title>
<meta name="robots" content="noindex"></head>
<body style="font-family:system-ui;background:#08194A;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="post" action="/api/dang-nhap" style="display:grid;gap:12px;width:min(320px,86vw)">
<h1 style="font-size:20px;margin:0">Cài đặt bảng giá VTEC</h1>
${sai ? '<div style="background:#FFC42E;color:#51380A;padding:8px 10px;font-size:13px">Mật khẩu chưa đúng</div>' : ""}
<input type="password" name="matkhau" placeholder="Mật khẩu" autofocus
 style="padding:12px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.1);color:#fff;font-size:15px">
<button style="padding:12px;background:#33A6DC;border:0;color:#06243B;font-weight:700;font-size:14px;cursor:pointer">Vào trang cài đặt</button>
</form></body></html>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const coPhien = phienOk(req.headers.cookie);
  const tu401 = () => { res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Chưa đăng nhập /cai-dat"); };
  try {
    if (req.method === "GET" && u.pathname === "/") { res.writeHead(200, { "Content-Type": MIME.html }); return res.end(trang("xem")); }
    if (req.method === "GET" && u.pathname === "/cai-dat") {
      res.writeHead(200, { "Content-Type": MIME.html });
      return res.end(coPhien ? trang("sua") : trangDangNhap(u.searchParams.has("sai")));
    }
    if (req.method === "POST" && u.pathname === "/api/dang-nhap") {
      const than = (await docThan(req, 4096)).toString();
      const mk = decodeURIComponent((than.match(/matkhau=([^&]*)/) || [])[1] || "").replace(/\+/g, " ");
      if (!soSanhMK(mk)) { res.writeHead(303, { Location: "/cai-dat?sai" }); return res.end(); }
      const an = (req.headers["x-forwarded-proto"] === "https") ? "; Secure" : "";
      res.writeHead(303, { Location: "/cai-dat",
        "Set-Cookie": `phien=${kyPhien(Date.now() + 30 * 864e5)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${an}` });
      return res.end();
    }
    if (u.pathname === "/api/noidung") {
      if (req.method === "GET") { res.writeHead(200, { "Content-Type": MIME.json });
        return res.end(existsSync(path.join(DL, "noidung.json")) ? readFileSync(path.join(DL, "noidung.json")) : "{}"); }
      if (!coPhien) return tu401();
      if (req.method === "POST") {
        const than = await docThan(req, 2 * 1024 * 1024);
        JSON.parse(than.toString()); // phải là JSON hợp lệ
        writeFileSync(path.join(DL, "noidung.json"), than);
        res.writeHead(200); return res.end("ok");
      }
      if (req.method === "DELETE") {
        if (existsSync(path.join(DL, "noidung.json"))) unlinkSync(path.join(DL, "noidung.json"));
        res.writeHead(200); return res.end("ok");
      }
    }
    if (req.method === "POST" && u.pathname === "/api/tep") {
      if (!coPhien) return tu401();
      const goc = (u.searchParams.get("ten") || "tep").replace(/[^\w.\-]+/g, "-").slice(-80);
      const duoi = goc.split(".").pop().toLowerCase();
      if (!["webp","jpg","jpeg","png","mp4","webm","mov"].includes(duoi)) { res.writeHead(400); return res.end("Chỉ nhận ảnh webp/jpg/png và video mp4/webm/mov"); }
      const ten = Date.now().toString(36) + "-" + goc;
      const dich = path.join(DL, "media", ten);
      const ghi = createWriteStream(dich);
      let n = 0, qua = false;
      req.on("data", (c) => { n += c.length; if (n > 200 * 1024 * 1024 && !qua) { qua = true; ghi.destroy(); req.destroy(); } });
      req.pipe(ghi);
      await new Promise((ok, loi) => { ghi.on("finish", ok); ghi.on("error", loi); req.on("error", loi); });
      if (qua) { try { unlinkSync(dich); } catch {} res.writeHead(413); return res.end("Tệp quá 200MB"); }
      res.writeHead(200, { "Content-Type": MIME.json });
      return res.end(JSON.stringify({ url: "/media/" + ten }));
    }
    if (req.method === "POST" && u.pathname === "/api/lien-he") {
      const than = await docThan(req, 10 * 1024);
      const d = JSON.parse(than.toString());
      appendFileSync(path.join(DL, "lien-he.jsonl"),
        JSON.stringify({ ten: String(d.ten||"").slice(0,200), sdt: String(d.sdt||"").slice(0,30),
          quanTam: String(d.quanTam||"").slice(0,100), luc: new Date().toISOString() }) + "\n");
      res.writeHead(200); return res.end("ok");
    }
    if (req.method === "GET" && u.pathname === "/api/lien-he") {
      if (!coPhien) return tu401();
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(existsSync(path.join(DL, "lien-he.jsonl")) ? readFileSync(path.join(DL, "lien-he.jsonl")) : "(chưa có ai để lại số)");
    }
    // Tự cập nhật: VPS tự tải trang.html mới nhất từ GitHub công khai và thay tại chỗ.
    // Chỉ chủ trang (đã đăng nhập /cai-dat) gọi được. KHÔNG đụng server.mjs để tránh hỏng máy chủ.
    if (req.method === "POST" && u.pathname === "/api/cap-nhat") {
      if (!coPhien) return tu401();
      const nhanh = env.GH_NHANH || "main";
      const kq = [];
      for (const t of TRANG_CAP_NHAT) {
        const nguon = "https://raw.githubusercontent.com/" + GH_REPO + "/" + encodeURIComponent(nhanh) + "/public/" + t.ten;
        try {
          const buf = await taiGit(nguon);
          const html = buf.toString("utf8");
          if (buf.length < 2048 || !/<!doctype html/i.test(html) || (t.dau && !html.includes(t.dau))) {
            kq.push({ ten: t.ten, ok: false, loi: "tệp không hợp lệ" }); continue;
          }
          const dich = path.join(GOC, "public", t.ten);
          const cu = existsSync(dich) ? statSync(dich).size : 0;
          try { if (existsSync(dich)) writeFileSync(dich + ".bak", readFileSync(dich)); } catch {}
          writeFileSync(dich, buf);
          kq.push({ ten: t.ten, ok: true, cu, moi: buf.length });
        } catch (e) { kq.push({ ten: t.ten, ok: false, loi: e.message }); }
      }
      const soOk = kq.filter((x) => x.ok).length;
      res.writeHead(soOk ? 200 : 502, { "Content-Type": MIME.json });
      return res.end(JSON.stringify({ ok: soOk > 0, nhanh, soOk, moi: (kq.find((x) => x.ok && x.ten === "trang.html") || {}).moi, ketQua: kq }));
    }
    {
      const mTrang = u.pathname.match(/^\/([12])\/?$/); // /1, /2 → public/1.html, public/2.html
      if (req.method === "GET" && mTrang) {
        const tep = path.join(GOC, "public", mTrang[1] + ".html");
        if (existsSync(tep)) { res.writeHead(200, { "Content-Type": MIME.html }); return res.end(readFileSync(tep)); }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Chưa có trang này");
      }
    }
    if (req.method === "GET" && u.pathname.startsWith("/media/")) {
      const ten = path.basename(u.pathname); // chặn ../
      for (const thu of [path.join(DL, "media", ten), path.join(GOC, "public", "media", ten)])
        if (existsSync(thu)) return guiTep(res, thu);
      res.writeHead(404); return res.end("Không có tệp này");
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Không có trang này");
  } catch (e) {
    res.writeHead(e.message === "to-qua" ? 413 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Lỗi: " + e.message);
  }
}).listen(PORT, "127.0.0.1", () => console.log("baogia.vtec.food chạy ở cổng " + PORT));
