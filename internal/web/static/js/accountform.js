// The 添加账户 form.

import { $, el } from "./dom.js";
import { api } from "./api.js";
import { explainErr } from "./errors.js";
import { flash } from "./toast.js";
import { askConfirm } from "./dialogs.js";
import { loadAccounts } from "./sidebar.js";
import { openBucket } from "./browse.js";
import { openModal, closeModal } from "./preview.js";

// One labelled control. The hint is a description (aria-describedby), not part
// of the label: inside the <label> it would be read as part of the field's name.
function field(labelText, input, hint) {
  const wrap = el("div", "field");
  const l = el("label", null, labelText);
  l.htmlFor = input.id;
  wrap.append(l, input);
  if (hint) {
    const h = el("span", "field-hint", hint);
    h.id = input.id + "-hint";
    input.setAttribute("aria-describedby", h.id);
    wrap.append(h);
  }
  return wrap;
}

// Endpoints and keys are identifiers, not prose: no autocapitalising them on a
// phone keyboard, no autocorrect, no red underlines.
function textInput(id, placeholder, value) {
  const i = el("input");
  i.id = id;
  i.type = "text";
  i.placeholder = placeholder || "";
  i.value = value || "";
  i.autocomplete = "off";
  i.spellcheck = false;
  i.setAttribute("autocapitalize", "none");
  i.setAttribute("autocorrect", "off");
  return i;
}

export function openAccountForm() {
  $("#mtitle").textContent = "添加账户";
  $("#mmeta").textContent = "";
  // download / open / close belong to the preview; the form has its own 取消
  $("#modal .head-actions").hidden = true;
  $("#modal").classList.add("narrow");
  const body = $("#mbody");
  body.innerHTML = "";

  const form = el("form", "account-form");
  const name = textInput("f-name", "minio");
  name.required = true;
  const endpoint = textInput("f-endpoint", "http://127.0.0.1:9000（留空表示 AWS）");
  endpoint.inputMode = "url";
  const region = textInput("f-region", "us-east-1", "us-east-1");
  const access = textInput("f-access", "access key id");
  access.required = true;
  const secret = el("input");
  secret.id = "f-secret";
  secret.type = "password";
  secret.placeholder = "secret access key";
  secret.autocomplete = "new-password";
  secret.required = true;
  const bucket = textInput("f-bucket", "可选，填了之后 acct: 直接进这个桶");
  const pathRow = el("label", "row");
  const path = el("input");
  path.type = "checkbox";
  path.id = "f-path";
  pathRow.htmlFor = path.id;
  pathRow.append(path, el("span", null, "path-style 寻址（自建服务通常需要，AWS 不要勾）"));

  const err = el("div", "form-err");
  err.setAttribute("role", "alert");
  const actions = el("div", "form-actions");
  const cancel = el("button", "ghost", "取消");
  cancel.type = "button";
  cancel.onclick = closeModal;
  const save = el("button", "btn-primary", "保存");
  save.type = "submit";
  actions.append(cancel, save);

  form.append(
    field("名称", name),
    field("Endpoint", endpoint),
    field("Region", region),
    field("Access Key", access),
    field("Secret Key", secret, "保存在服务端配置文件里，接口不会回传"),
    field("默认桶", bucket),
    pathRow,
    err,
    actions
  );

  // AWS has no custom endpoint and must not use path-style addressing
  const syncPath = () => {
    const custom = endpoint.value.trim() !== "";
    path.disabled = !custom;
    path.checked = custom;
  };
  endpoint.addEventListener("input", syncPath);
  syncPath();
  // the server's one-liner is about the previous attempt; typing starts a new one
  form.addEventListener("input", () => {
    if (err.textContent) err.textContent = "";
  });

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    err.textContent = "";
    save.disabled = true;
    const data = {
      name: name.value.trim(),
      endpoint: endpoint.value.trim(),
      region: region.value.trim(),
      access_key: access.value.trim(),
      secret_key: secret.value,
      path_style: path.checked,
      default_bucket: bucket.value.trim(),
    };
    try {
      await saveAccount(data);
      closeModal();
      await loadAccounts();
      if (data.default_bucket) openBucket(data.name, data.default_bucket, "");
      flash(`已添加账户 ${data.name}`);
    } catch (e) {
      if (e.status === 409 && await askConfirm(`账户 ${data.name} 已存在，用新配置覆盖它？`, "覆盖")) {
        try {
          await saveAccount({ ...data, replace: true });
          closeModal();
          await loadAccounts();
          if (data.default_bucket) openBucket(data.name, data.default_bucket, "");
          flash(`已更新账户 ${data.name}`);
          return;
        } catch (e2) {
          err.textContent = explainErr(e2.message) || e2.message;
        }
      } else {
        // the same one-liner the toasts use: this form is where a wrong endpoint
        // or key is first typed, so it is the last place to show raw SDK text
        err.textContent = explainErr(e.message) || e.message;
      }
      save.disabled = false;
    }
  };

  body.append(form);
  openModal();
  name.focus();
}

async function saveAccount(data) {
  await api("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
