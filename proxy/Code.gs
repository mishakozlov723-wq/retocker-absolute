// Retocker — посредник между программой и Groq (работает на серверах Google). Версия 2.
// Ключ Groq не хранится здесь: его присылает программа в каждом запросе.
function doGet() { return out({ ok: true, app: 'retocker-voice', v: 2, t: Date.now() }); }

function doPost(e) {
  var t0 = Date.now(), b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out({ error: 'bad json' }); }
  if (!b.key) return out({ error: 'no key' });
  var auth = { Authorization: 'Bearer ' + b.key };
  if (b.ping) {
    var p = UrlFetchApp.fetch('https://api.groq.com/openai/v1/models', { headers: auth, muteHttpExceptions: true });
    return out({ ok: p.getResponseCode() === 200, code: p.getResponseCode(), v: 2, ms: Date.now() - t0 });
  }
  if (b.chat) {
    var c = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'post', contentType: 'application/json', headers: auth, payload: JSON.stringify(b.chat), muteHttpExceptions: true });
    var cj = {};
    try { cj = JSON.parse(c.getContentText()); } catch (x) {}
    var msg = cj.choices && cj.choices[0] && cj.choices[0].message ? cj.choices[0].message.content : '';
    return out({ code: c.getResponseCode(), text: msg || '', error: cj.error ? cj.error.message : '', ms: Date.now() - t0 });
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(b.audio), b.mime || 'audio/webm', 'audio.' + (b.ext || 'webm'));
  var form = { file: blob, model: b.model || 'whisper-large-v3-turbo', response_format: 'json', temperature: '0' };
  if (b.lang) form.language = b.lang;
  if (b.prompt) form.prompt = b.prompt;
  var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'post', headers: auth, payload: form, muteHttpExceptions: true });
  var code = r.getResponseCode(), j = {};
  try { j = JSON.parse(r.getContentText()); } catch (x) {}
  return out({ code: code, text: j.text || '', error: j.error ? j.error.message : (code === 200 ? '' : r.getContentText().slice(0, 300)), ms: Date.now() - t0 });
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
