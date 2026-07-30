'use strict';
// User-authored module packages served for dynamic import: study PACKAGES (a folder per
// study: <id>/<id>.js + optional meta.json), tool PACKAGES (<id>/<id>.js + optional
// icon.png + vocab.json) and the tool-icon upload.
const fs = require('fs');
const path = require('path');
const { ROOT, sendJson, readBody, openFolder, sanitizeModName, readMeta } = require('./util.js');

// Studies are FOLDER PACKAGES under packages/studies/<id>/ : <id>.js (the module) + optional
// meta.json. The folder is the shareable unit (drop a folder in and it loads). A study folder
// is one that holds <id>.js, so loose reference dirs (archive/, examples/) are skipped.
const STUDIES_DIR = path.join(ROOT, 'packages', 'studies');
// Package metadata (name/description) is NOT read from the module source. It comes from a package's
// meta.json (wired separately). Discovery here reports the folder id + file-based facts (icon/vocab
// presence) only, so nothing is scraped from the code.
function handleUserStudies(req, res, urlPath, query) {
  if (urlPath === '/api/user-studies' && req.method === 'GET') {
    const studies = [];
    try {
      for (const e of fs.readdirSync(STUDIES_DIR, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (!fs.existsSync(path.join(STUDIES_DIR, e.name, e.name + '.js'))) continue;
        const meta = readMeta(path.join(STUDIES_DIR, e.name));
        const icon = meta.icon ? '/packages/studies/' + e.name + '/' + meta.icon : '';
        studies.push({ id: e.name, name: meta.name || '', description: meta.description || '', icon });
      }
    } catch (_) {}
    return sendJson(res, 200, { studies });
  }
  if (urlPath === '/api/user-studies/file' && req.method === 'GET') {
    const id = sanitizeModName(query.get('name'));
    try {
      return sendJson(res, 200, { code: fs.readFileSync(path.join(STUDIES_DIR, id, id + '.js'), 'utf-8') });
    } catch (_) {
      return sendJson(res, 404, { error: 'not found' });
    }
  }
  if (urlPath === '/api/user-studies' && req.method === 'POST') {
    // create / edit a study package
    return readBody(req, (d) => {
      const name = sanitizeModName(d.name);
      if (!name) return sendJson(res, 400, { error: 'invalid name' });
      if (typeof d.code !== 'string') return sendJson(res, 400, { error: 'no code' });
      fs.mkdirSync(path.join(STUDIES_DIR, name), { recursive: true });
      fs.writeFileSync(path.join(STUDIES_DIR, name, name + '.js'), d.code);
      return sendJson(res, 200, { ok: true, file: name });
    });
  }
  if (urlPath === '/api/user-studies/package' && req.method === 'POST') {
    // install a whole study FOLDER, tree intact
    return readBody(req, (d) => {
      const id = sanitizeModName(d.id);
      if (!id) return sendJson(res, 400, { error: 'invalid id' });
      if (!Array.isArray(d.files) || !d.files.length) return sendJson(res, 400, { error: 'no files' });
      const base = path.join(STUDIES_DIR, id);
      try {
        for (const f of d.files) {
          const rel = String((f && f.path) || '').replace(/\\/g, '/');
          if (!rel || rel.split('/')[0] !== id) continue; // every file must live under the package folder
          const dest = path.join(STUDIES_DIR, rel);
          if (dest !== base && !dest.startsWith(base + path.sep)) continue; // no traversal outside the package
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (typeof f.b64 === 'string') fs.writeFileSync(dest, Buffer.from(f.b64, 'base64'));
          else fs.writeFileSync(dest, String(f.text || ''));
        }
      } catch (e) {
        return sendJson(res, 500, { error: String((e && e.message) || e) });
      }
      return sendJson(res, 200, { ok: true, id });
    });
  }
  if (urlPath === '/api/user-studies/delete' && req.method === 'POST') {
    return readBody(req, (d) => {
      const name = sanitizeModName(d.name);
      try {
        fs.rmSync(path.join(STUDIES_DIR, name), { recursive: true, force: true });
      } catch (_) {}
      return sendJson(res, 200, { ok: true });
    });
  }
  return sendJson(res, 404, { error: 'unknown endpoint' });
}

// Tools are FOLDER PACKAGES under packages/tools/<id>/ : <id>.js (code) + optional
// icon.png + optional vocab.json. The folder is the shareable unit (import = drop a folder in).
const TOOLS_DIR = path.join(ROOT, 'packages', 'tools');
function handleUserTools(req, res, urlPath, query) {
  if (urlPath === '/api/user-tools' && req.method === 'GET') {
    const tools = [],
      icons = [];
    try {
      for (const e of fs.readdirSync(TOOLS_DIR, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const f = path.join(TOOLS_DIR, e.name);
        const hasIcon = fs.existsSync(path.join(f, 'icon.png'));
        const hasVocab = fs.existsSync(path.join(f, 'vocab.json'));
        if (hasIcon) icons.push(e.name);
        const toolFile = path.join(f, e.name + '.js');
        const meta = readMeta(f);
        if (fs.existsSync(toolFile))
          tools.push({
            folder: e.name,
            name: meta.name || '',
            description: meta.description || '',
            icon: meta.icon || '',
            hasIcon,
            hasVocab,
          });
      }
    } catch (_) {}
    return sendJson(res, 200, { tools, icons });
  }
  if (urlPath === '/api/user-tools' && req.method === 'POST') {
    // create / edit a tool package
    return readBody(req, (d) => {
      const name = sanitizeModName(d.name);
      if (!name) return sendJson(res, 400, { error: 'invalid name' });
      if (typeof d.code !== 'string') return sendJson(res, 400, { error: 'no code' });
      fs.mkdirSync(path.join(TOOLS_DIR, name), { recursive: true });
      fs.writeFileSync(path.join(TOOLS_DIR, name, name + '.js'), d.code);
      return sendJson(res, 200, { ok: true, folder: name });
    });
  }
  if (urlPath === '/api/user-tools/file' && req.method === 'GET') {
    const name = sanitizeModName(query.get('name'));
    try {
      return sendJson(res, 200, { code: fs.readFileSync(path.join(TOOLS_DIR, name, name + '.js'), 'utf-8') });
    } catch (_) {
      return sendJson(res, 404, { error: 'not found' });
    }
  }
  if (urlPath === '/api/user-tools/package' && req.method === 'POST') {
    // install a whole tool FOLDER (<id>.js + icon.png + vocab.json), tree intact
    return readBody(req, (d) => {
      const id = sanitizeModName(d.id);
      if (!id) return sendJson(res, 400, { error: 'invalid id' });
      if (!Array.isArray(d.files) || !d.files.length) return sendJson(res, 400, { error: 'no files' });
      const base = path.join(TOOLS_DIR, id);
      try {
        for (const f of d.files) {
          const rel = String((f && f.path) || '').replace(/\\/g, '/');
          if (!rel || rel.split('/')[0] !== id) continue; // every file must live under the package folder
          const dest = path.join(TOOLS_DIR, rel);
          if (dest !== base && !dest.startsWith(base + path.sep)) continue; // no traversal outside the package
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (typeof f.b64 === 'string') fs.writeFileSync(dest, Buffer.from(f.b64, 'base64'));
          else fs.writeFileSync(dest, String(f.text || ''));
        }
      } catch (e) {
        return sendJson(res, 500, { error: String((e && e.message) || e) });
      }
      return sendJson(res, 200, { ok: true, id });
    });
  }
  if (urlPath === '/api/user-tools/delete' && req.method === 'POST') {
    return readBody(req, (d) => {
      const name = sanitizeModName(d.name);
      try {
        fs.rmSync(path.join(TOOLS_DIR, name), { recursive: true, force: true });
      } catch (_) {}
      return sendJson(res, 200, { ok: true });
    });
  }
  if (urlPath === '/api/user-tools/open' && req.method === 'POST') {
    // open the tools folder (drop packages in)
    openFolder(TOOLS_DIR);
    return sendJson(res, 200, { ok: true });
  }
  if (urlPath === '/api/user-tools/icon' && req.method === 'DELETE') {
    // remove a tool's package icon.png (revert to glyph)
    const name = sanitizeModName(query.get('name'));
    if (name) {
      try {
        fs.unlinkSync(path.join(TOOLS_DIR, name, 'icon.png'));
      } catch (_) {}
    }
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { error: 'unknown endpoint' });
}

// tool icon upload: a PNG data URL -> the tool's icon INSIDE its package folder, named by the tool id
// (packages/tools/<folder>/<id>.png). `folder` is the package (parent); a tool set (many tools in one
// folder) keeps every icon there, one per child id — never a phantom folder per tool. folder defaults to id.
function handleToolIcon(req, res) {
  return readBody(req, (d) => {
    const id = sanitizeModName(d.id);
    const folder = sanitizeModName(d.folder) || id;
    const m = /^data:image\/png;base64,(.+)$/.exec(d.dataUrl || '');
    if (!id) return sendJson(res, 400, { error: 'invalid id' });
    if (!m) return sendJson(res, 400, { error: 'expected a PNG data URL' });
    try {
      const dir = path.join(ROOT, 'packages', 'tools', folder);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, id + '.png'), Buffer.from(m[1], 'base64'));
    } catch (e) {
      return sendJson(res, 500, { error: String((e && e.message) || e) });
    }
    return sendJson(res, 200, { ok: true, path: '/packages/tools/' + folder + '/' + id + '.png' });
  });
}

module.exports = { handleUserStudies, handleUserTools, handleToolIcon };
