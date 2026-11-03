// Naming a recognised S3 failure, and the shared error card.

import { el, ICON, icon } from "./dom.js";

// explainErr names the cause in one line. It returns null for anything it does
// not recognise so the caller can fall back to the server's own hint.
export function explainErr(raw) {
  const t = String(raw).toLowerCase();
  if (t.includes("connection refused")) return "endpoint 拒绝了连接";
  if (t.includes("no such host")) return "解析不到 endpoint 域名";
  if (t.includes("timeout") || t.includes("deadline")) return "endpoint 没有响应";
  if (t.includes("x509") || t.includes("certificate")) return "endpoint 的证书不受信任";
  if (t.includes("signaturedoesnotmatch")) return "secret_key 不对，签名验不过";
  if (t.includes("invalidaccesskeyid")) return "endpoint 上没有这个 access_key";
  if (t.includes("accessdenied")) return "凭据没有权限";
  if (t.includes("bucketnotempty")) return "桶不是空的";
  if (t.includes("nosuchbucket")) return "桶不存在";
  return null;
}

// errCard is the one error layout: a headline, the thing it applies to, a retry
// and the raw text folded away. It is used by the sidebar and by the table.
export function errCard({ title, sub, raw, retry }) {
  const box = el("div", "err-card");
  const head = el("div", "head");
  head.append(icon(ICON.warn), el("span", null, title));
  box.append(head);
  if (sub) box.append(el("div", "sub", sub));

  const acts = el("div", "acts");
  const again = el("button", "retry", "重试");
  again.onclick = retry;
  acts.append(again);
  box.append(acts);

  const more = document.createElement("details");
  more.append(el("summary", null, "查看错误信息"));
  more.append(el("pre", null, String(raw)));
  box.append(more);
  return box;
}
