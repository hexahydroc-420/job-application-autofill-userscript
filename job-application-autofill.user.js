// ==UserScript==
// @name         求人応募フォーム入力補助（汎用ATS版）
// @namespace    job-application-autofill-userscript
// @homepageURL  https://github.com/hexahydroc-420/job-application-autofill-userscript
// @updateURL    https://raw.githubusercontent.com/hexahydroc-420/job-application-autofill-userscript/main/job-application-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/hexahydroc-420/job-application-autofill-userscript/main/job-application-autofill.user.js
// @version      4.3.2
// @description  複数プロフィールをGUIで管理し、学歴・職歴・資格・企業独自回答を並べ替え可能。HRMOS等の「職歴を追加」型の動的追加に対応し、「必須項目のみ入力」も選択可能。プルダウン・ラジオ・チェックボックス・複数選択も補助します。送信・同意・ファイル添付は自動化しません。
// @match        https://hrmos.co/pages/*/jobs/*/apply*
// @match        https://boards.greenhouse.io/*
// @match        https://job-boards.greenhouse.io/*
// @match        https://jobs.lever.co/*
// @match        https://jobs.eu.lever.co/*
// @match        https://apply.workable.com/*
// @match        https://jobs.ashbyhq.com/*
// @match        https://herp.careers/*
// @match        https://open.talentio.com/*
// @match        https://*.talentio.com/*
// @match        https://jobs.smartrecruiters.com/*
// @match        https://careers.smartrecruiters.com/*
// @match        https://*.myworkdayjobs.com/*
// @match        https://*.workdayjobs.com/*
// @match        https://jobs.jobvite.com/*
// @match        https://*.breezy.hr/*
// @match        https://*.recruitee.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'job-application-autofill-public-profiles-v1';
  const PANEL_ID = 'job-autofill-panel';
  const MODAL_ID = 'job-autofill-modal';
  const EDITOR_WINDOW_KEY = 'job-application-autofill-public-editor-window-v1';
  const PANEL_WINDOW_KEY = 'job-application-autofill-public-panel-window-v1';
  const HIGHLIGHT_CLASS = 'job-autofill-highlight';
  const FILLED_ATTR = 'data-job-autofill-filled';

  // 公開版には個人情報を一切同梱しません。プロフィール設定画面から登録してください。
  const DEFAULT_PROFILE = {
    basic: {
      name: '',
      lastName: '',
      firstName: '',
      furigana: '',
      birth: { year: '', month: '', day: '' },
      sex: '',
      email: '',
      phone: '',
      postalCode: '',
      address1: '',
      address2: '',
      country: '',
      state: '',
      city: '',
      streetAddress: '',
      building: '',
      addressEnglish1: '',
      addressEnglish2: '',
      preferredContactPeriod: '',
      availableStartDate: ''
    },
    education: [],
    workExperience: [],
    workNotes: '',
    certifications: [],
    links: {
      github: '',
      linkedin: '',
      portfolio: '',
      website: ''
    },
    salary: {
      type: '',
      amount: ''
    },
    wishes: '',
    selfPR: '',
    message: '',
    formPreferences: {
      preferredLocation: '',
      otherLocations: [],
      salaryType: '',
      salaryAmount: '',
      requestNotes: '',
      attachmentUrls: '',
      priorContact: ''
    },
    customAnswers: []
  };

  const SITE_ADAPTERS = [
    { id: 'hrmos', name: 'HRMOS', test: h => h === 'hrmos.co', repeatMode: 'hrmos' },
    { id: 'greenhouse', name: 'Greenhouse', test: h => /(^|\.)greenhouse\.io$/.test(h), repeatMode: 'generic' },
    { id: 'lever', name: 'Lever', test: h => /(^|\.)lever\.co$/.test(h), repeatMode: 'generic' },
    { id: 'workable', name: 'Workable', test: h => h === 'apply.workable.com', repeatMode: 'generic' },
    { id: 'ashby', name: 'Ashby', test: h => h === 'jobs.ashbyhq.com', repeatMode: 'generic' },
    { id: 'herp', name: 'HERP Hire', test: h => h === 'herp.careers', repeatMode: 'generic' },
    { id: 'talentio', name: 'Talentio', test: h => /(^|\.)talentio\.com$/.test(h), repeatMode: 'generic' },
    { id: 'smartrecruiters', name: 'SmartRecruiters', test: h => /(^|\.)smartrecruiters\.com$/.test(h), repeatMode: 'generic' },
    { id: 'workday', name: 'Workday', test: h => /(^|\.)(myworkdayjobs|workdayjobs)\.com$/.test(h), repeatMode: 'generic' },
    { id: 'jobvite', name: 'Jobvite', test: h => h === 'jobs.jobvite.com', repeatMode: 'generic' },
    { id: 'breezy', name: 'Breezy HR', test: h => /\.breezy\.hr$/.test(h), repeatMode: 'generic' },
    { id: 'recruitee', name: 'Recruitee', test: h => /\.recruitee\.com$/.test(h), repeatMode: 'generic' }
  ];

  function detectSiteAdapter() {
    const host = location.hostname.toLowerCase();
    return SITE_ADAPTERS.find(x => x.test(host)) || { id: 'generic', name: '汎用フォーム', repeatMode: 'generic' };
  }

  const SITE = detectSiteAdapter();
  const SENSITIVE_NEGATIVE_RX = /(緊急|emergency|推薦者|referr?er|reference|上司|manager.*email|recruiter|採用担当|代理人|guardian|保護者)/i;
  // 漢字氏名欄とフリガナ欄を混同しないための除外語。
  const NAME_PHONETIC_RX = /(ふりがな|フリガナ|振り仮名|カナ|かな|セイ|メイ|せい|めい|読み|よみ|phonetic|furigana|kana)/i;

  const RX = {
    // 日本語では \b が期待通り境界判定しないため、氏名系は専用リゾルバでも判定します。
    name: /(氏名|姓名|お名前|フルネーム|名前(?:\s*[（(]\s*漢字\s*[）)])?|full\s*name|legal\s*name|applicant\s*name|candidate\s*name)/i,
    firstName: /(名(?:\s*[（(]\s*漢字\s*[）)])?|first[\s_-]*name|given[\s_-]*name|legal[\s_-]*first[\s_-]*name|preferred[\s_-]*first[\s_-]*name)/i,
    lastName: /(姓(?:\s*[（(]\s*漢字\s*[）)])?|苗字|名字|last[\s_-]*name|family[\s_-]*name|surname|legal[\s_-]*last[\s_-]*name|preferred[\s_-]*last[\s_-]*name)/i,
    furigana: /(ふりがな|フリガナ|furigana|kana)/i,
    birth: /(生年月日|誕生日|date\s*of\s*birth|birth\s*date|birthday)/i,
    sex: /(性別|sex|gender)/i,
    email: /(メールアドレス|e-?mail(?:\s*address)?)/i,
    phone: /(電話番号|携帯番号|phone(?:\s*number)?|telephone|mobile)/i,
    address: /(現住所|住所|address(?:\s*line)?|street\s*address)/i,
    postal: /(郵便番号|postal|postcode|zip)/i,
    country: /(^|\b)(国|country|country\s*of\s*residence)($|\b)/i,
    state: /(都道府県|state|province|prefecture|address\s*level\s*1)/i,
    city: /(市区町村|city|location\s*\(city\)|current\s*location)/i,
    preferredContact: /(連絡.*(希望|可能)|preferred.*contact|contact.*period|notice\s*period)/i,
    availableStart: /(入社.*(可能|時期)|勤務開始|available.*start|start.*date|availability)/i,
    school: /(学校名|学校|school\s*name|education.*school)/i,
    fieldStudy: /(学部|学科|専攻|discipline|field\s*of\s*study|major)/i,
    educationLevel: /(学歴区分|最終学歴|学位(?:等)?|degree|level\s*of\s*education|degree\s*level)/i,
    duration: /^(期間|在籍期間|在学期間|勤務期間|duration|dates?)$/i,
    company: /(会社名|勤務先|所属会社|company\s*name|employer)/i,
    departmentTitle: /(部署|役職|職位|department|job\s*title|title)/i,
    occupation: /^(職種(?:名)?|職業|occupation|job\s*type|position)$/i,
    employmentType: /(雇用形態|契約形態|働き方|form\s*of\s*employment|employment\s*type)/i,
    responsibilities: /(職務内容|業務内容|担当業務|responsibilit|job\s*description|description\s*of\s*duties)/i,
    workNotes: /(職歴.*(補足|備考)|職務経歴.*(補足|備考)|notes?\s*about\s*work\s*experience)/i,
    issueDate: /(取得日|取得年月|発行日|issue\s*date|date\s*obtained)/i,
    qualification: /(資格名|免許.*名称|qualification\s*name|license.*name|certification)/i,
    currentSalary: /(現給与|現在.*(年収|給与)|current\s*(annual\s*)?salary|current\s*compensation)/i,
    wishes: /(希望条件|希望記入欄|その他.*希望|your\s*other\s*wishes|other\s*wishes|additional\s*requests?)/i,
    message: /^(メッセージ|応募先へのメッセージ|message|comments?)$/i,
    selfPR: /(自己PR|自己紹介|アピール|professional\s*summary|personal\s*statement|profile\s*summary|about\s*you|additional\s*information|cover\s*letter\s*text|企業向けコメント)/i,
    github: /github/i,
    linkedin: /linked\s*in|linkedin/i,
    portfolio: /(portfolio|ポートフォリオ)/i,
    website: /(website|web\s*site|personal\s*site|ホームページ)/i
  };

  const OPTION_ALIASES = new Map(Object.entries({
    '男性': 'Male', '男': 'Male', 'male': 'Male',
    '女性': 'Female', '女': 'Female', 'female': 'Female',
    '中卒': 'Junior High School', '中学校': 'Junior High School',
    '高卒': 'High School', '高校': 'High School',
    '短大': 'Associate Degree', '短期大学': 'Associate Degree', '専門卒': 'Associate Degree',
    '大卒': 'Bachelor', '大学卒': 'Bachelor', '学士': 'Bachelor', 'bachelor degree': 'Bachelor',
    '修士': 'Master', '大学院修士': 'Master', 'master degree': 'Master',
    '博士': 'PhD', 'phd': 'PhD', 'doctoral degree': 'PhD',
    'その他': 'Others',
    '正社員': 'Full time', 'full-time': 'Full time',
    '契約社員': 'Contractual staff',
    '業務委託': 'Sub-contractor', '請負': 'Sub-contractor',
    'インターン': 'Intern',
    'アルバイト': 'Part-time', 'パート': 'Part-time',
    '派遣社員': 'Temporary staff', '派遣': 'Temporary staff',
    '時給': 'Hourly', 'hourly': 'Hourly',
    '日給': 'Daily', 'daily': 'Daily',
    '月給': 'Monthly', 'monthly': 'Monthly',
    '年収': 'Annual', '年俸': 'Annual', 'annual': 'Annual'
  }));

  let lastReport = null;
  let observerTimer = null;

  function clean(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function norm(value) {
    return clean(value)
      .normalize('NFKC')
      .replace(/\brequired\b/gi, ' ')
      .replace(/必須/g, ' ')
      .replace(/[：:※*＊]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function meaningful(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getRoots() {
    const roots = [document];
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        if (frame.contentDocument?.documentElement) roots.push(frame.contentDocument);
      } catch (_) {}
    }
    return roots;
  }

  function all(selector, root = null) {
    if (root) return [...root.querySelectorAll(selector)];
    return getRoots().flatMap(r => [...r.querySelectorAll(selector)]);
  }

  function visibleControls(root = null) {
    return all('input, select, textarea', root).filter(el => {
      if (el instanceof HTMLInputElement) {
        if (['hidden', 'submit', 'button', 'reset'].includes(el.type)) return false;
        if (el.name === 'g-recaptcha-response') return false;
      }
      return !el.disabled;
    });
  }

  function rowOf(el) {
    return el.closest('tr');
  }

  function firstCellLabel(row, el = null) {
    if (!row) return '';
    const cells = [...row.children].filter(x => /^(TH|TD)$/.test(x.tagName));
    for (const cell of cells) {
      if (el && cell.contains(el)) continue;
      const t = clean(cell.innerText || cell.textContent);
      if (t) return t;
    }
    const th = row.querySelector('th');
    return clean(th?.innerText || th?.textContent);
  }

  function explicitLabel(el) {
    const found = [];
    const aria = el.getAttribute('aria-label');
    if (aria) found.push(aria);
    if (el.id) {
      try {
        for (const label of el.ownerDocument.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)) {
          found.push(label.innerText || label.textContent || '');
        }
      } catch (_) {}
    }
    const parentLabel = el.closest('label');
    if (parentLabel) found.push(parentLabel.innerText || parentLabel.textContent || '');
    return clean(found.filter(Boolean).join(' '));
  }

  function sectionText(el) {
    const section = el.closest('app-card-section, section, fieldset');
    if (!section) return '';
    const heading = section.querySelector('h1,h2,h3,h4,h5,legend,[class*="title"],[class*="heading"]');
    if (heading) return clean(heading.innerText || heading.textContent).slice(0, 180);
    const txt = clean(section.innerText || section.textContent);
    return txt.slice(0, 180);
  }

  function fieldContainer(el) {
    return el.closest('tr, fieldset, [data-field], [data-testid*="field"], .field, .form-field, .application-field, .input-wrapper, .form-group, .question, li') || el.parentElement;
  }

  function labelInfo(el) {
    const row = rowOf(el);
    const rowLabel = firstCellLabel(row, el);
    const label = explicitLabel(el);
    const placeholder = clean(el.getAttribute('placeholder'));
    const aria = clean(el.getAttribute('aria-label'));
    const section = sectionText(el);
    const nameAttr = clean(el.getAttribute('name'));
    const idAttr = clean(el.id);
    const autocomplete = clean(el.getAttribute('autocomplete'));
    const dataTestId = clean(el.getAttribute('data-testid'));
    const container = fieldContainer(el);
    let nearText = '';
    if (container) {
      const t = clean(container.innerText || container.textContent);
      if (t && t.length <= 500) nearText = t;
    }
    if (!nearText) {
      for (let p = el.parentElement, depth = 0; p && depth < 7; p = p.parentElement, depth++) {
        const t = clean(p.innerText || p.textContent);
        if (t && t.length <= 300) { nearText = t; break; }
      }
    }
    const options = el instanceof HTMLSelectElement
      ? [...el.options].map(o => clean(o.textContent))
      : [];
    const role = clean(el.getAttribute?.('role'));
    const isChoice = (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type))
      || ['radio', 'checkbox', 'switch', 'option'].includes(role)
      || el.hasAttribute?.('aria-pressed');
    const radioLabel = isChoice
      ? clean(el.closest('label, hrm-radio-button, hrm-checkbox, [role="radio"], [role="checkbox"], [role="switch"], [role="option"]')?.innerText
        || el.getAttribute?.('aria-label') || el.textContent || '')
      : '';
    return {
      row,
      container,
      rowLabel,
      label,
      placeholder,
      aria,
      section,
      nameAttr,
      idAttr,
      autocomplete,
      dataTestId,
      nearText,
      options,
      radioLabel,
      combined: clean([rowLabel, label, aria, placeholder, radioLabel, nameAttr, idAttr, autocomplete, dataTestId, nearText, section].filter(Boolean).join(' | '))
    };
  }

  const REQUIRED_TOKEN_RX = /(?:^|[\s:：※*＊・\-／/（(])(?:必須|required|mandatory)(?:$|[\s:：※*＊・\-／/）)])/i;

  function hasRequiredMarkerText(text) {
    const t = clean(text);
    return !!t && REQUIRED_TOKEN_RX.test(t);
  }

  function isRequiredControl(el) {
    if (!el) return false;
    try {
      if (el.required === true) return true;
      if (el.getAttribute?.('required') !== null) return true;
      if (el.getAttribute?.('aria-required') === 'true') return true;
      if (/^(true|required|1)$/i.test(clean(el.getAttribute?.('data-required')))) return true;
      const ownClass = typeof el.className === 'string' ? el.className : '';
      if (/(^|[\s_-])(?:required|mandatory|is-required|field-required)(?=$|[\s_-])/i.test(ownClass)) return true;
    } catch (_) {}
    const info = labelInfo(el);
    for (const text of [info.rowLabel, info.label, info.aria, info.radioLabel]) {
      if (hasRequiredMarkerText(text)) return true;
    }
    const container = info.container;
    if (container) {
      try {
        if (container.getAttribute?.('aria-required') === 'true' || /^(true|required|1)$/i.test(clean(container.getAttribute?.('data-required')))) return true;
        const cls = typeof container.className === 'string' ? container.className : '';
        if (/(^|[\s_-])(?:required|mandatory|is-required|field-required)(?=$|[\s_-])/i.test(cls)) return true;
        const marker = container.querySelector?.('[aria-required="true"],[data-required="true"],[data-required="required"],.required,.is-required,.field-required,[class*="mandatory"]');
        if (marker && (marker === el || hasRequiredMarkerText(marker.innerText || marker.textContent || marker.getAttribute?.('aria-label') || '') || /required|mandatory/i.test(String(marker.className || '')))) return true;
        const t = clean(container.innerText || container.textContent);
        if (t && t.length <= 260 && hasRequiredMarkerText(t)) return true;
      } catch (_) {}
    }
    for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (node === document.body || node === document.documentElement) break;
      const text = clean(node.innerText || node.textContent);
      if (!text || text.length > 340) continue;
      let controls = [];
      try { controls = [...node.querySelectorAll('input,select,textarea,[role="radio"],[role="checkbox"],[role="switch"],[role="option"]')]; } catch (_) {}
      const nativeChoices = controls.length > 1 && controls.every(c =>
        (c instanceof HTMLInputElement && ['radio', 'checkbox'].includes(c.type))
        || ['radio', 'checkbox', 'switch', 'option'].includes(norm(c.getAttribute?.('role')))
      );
      const dateSelectGroup = controls.length > 1 && controls.length <= 4 && controls.every(c => c instanceof HTMLSelectElement && !!datePartKind(c));
      const cohesive = controls.length === 1 || nativeChoices || dateSelectGroup;
      if (!cohesive) continue;
      if (node.getAttribute?.('aria-required') === 'true' || /^(true|required|1)$/i.test(clean(node.getAttribute?.('data-required')))) return true;
      if (hasRequiredMarkerText(text)) return true;
    }
    return false;
  }

  let activeAutofillInputMode = 'all';
  function isRequiredOnlyMode() { return activeAutofillInputMode === 'required'; }
  function canAutofillControl(el) { return !isRequiredOnlyMode() || isRequiredControl(el); }

  function rowLabel(row) {
    if (!row) return '';
    const sample = row.querySelector('input,select,textarea');
    return firstCellLabel(row, sample);
  }

  function rowsMatching(regex, scope = document) {
    return [...scope.querySelectorAll('tr')].filter(row => regex.test(clean(rowLabel(row))));
  }


  function controlsMatching(regex, scope = null, options = {}) {
    const { tag = null, type = null, excludeNegative = true } = options;
    return visibleControls(scope).filter(el => {
      if (tag && el.tagName.toLowerCase() !== tag) return false;
      if (type && !(el instanceof HTMLInputElement && el.type === type)) return false;
      const info = labelInfo(el);
      if (excludeNegative && SENSITIVE_NEGATIVE_RX.test(info.combined)) return false;
      return regex.test(info.combined);
    });
  }

  function fieldHostsMatching(regex, scope = document) {
    const seen = new Set();
    const result = [];
    for (const el of visibleControls(scope)) {
      if (!regex.test(labelInfo(el).combined)) continue;
      const host = fieldContainer(el);
      if (host && !seen.has(host)) { seen.add(host); result.push(host); }
    }
    return result;
  }

  function sectionForAnchor(regex) {
    for (const root of getRoots()) {
      const row = rowsMatching(regex, root)[0];
      if (!row) continue;
      return row.closest('app-card-section, section, fieldset') || row.parentElement?.parentElement || root;
    }
    const control = controlsMatching(regex)[0];
    if (control) return control.closest('app-card-section, section, fieldset, form') || control.ownerDocument;
    return document;
  }

  function bestControl(regex, options = {}) {
    const {
      type = null,
      tag = null,
      scope = null,
      occurrence = 0,
      placeholderRegex = null,
      optionRegex = null,
      autocompleteRegex = null,
      negativeRegex = SENSITIVE_NEGATIVE_RX
    } = options;
    const controls = visibleControls(scope || null);
    const scored = [];
    controls.forEach((el, index) => {
      if (type && !(el instanceof HTMLInputElement && el.type === type)) return;
      if (tag && el.tagName.toLowerCase() !== tag) return;
      const info = labelInfo(el);
      let score = 0;
      if (negativeRegex && negativeRegex.test(info.combined)) score -= 250;
      if (regex?.test(info.rowLabel)) score += 110;
      if (regex?.test(info.label)) score += 105;
      if (regex?.test(info.radioLabel)) score += 95;
      if (regex?.test(info.aria)) score += 90;
      if (regex?.test(info.nameAttr)) score += 82;
      if (regex?.test(info.idAttr)) score += 78;
      if (regex?.test(info.dataTestId)) score += 75;
      if (regex?.test(info.placeholder)) score += 68;
      if (regex?.test(info.nearText)) score += 45;
      if (regex?.test(info.section)) score += 18;
      if (placeholderRegex?.test(info.placeholder)) score += 95;
      if (autocompleteRegex?.test(info.autocomplete)) score += 120;
      if (optionRegex && info.options.some(x => optionRegex.test(x))) score += 60;
      if (score > 0) scored.push({ el, score, index });
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored[occurrence]?.el || null;
  }

  function setNativeValue(el, value) {
    if (!meaningful(value) || !el || !canAutofillControl(el)) return false;
    const v = String(value);
    el.focus?.({ preventScroll: true });
    let proto;
    if (el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    else proto = HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    try {
      if (setter) setter.call(el, v);
      else el.value = v;
    } catch (_) {
      el.value = v;
    }
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.setAttribute(FILLED_ATTR, '1');
    return true;
  }

  function canonicalOption(value) {
    const n = norm(value);
    return OPTION_ALIASES.get(n) || String(value);
  }

  function optionCandidateNorms(value) {
    const raw = norm(value);
    const canonical = norm(canonicalOption(value));
    const candidates = new Set([raw, canonical].filter(Boolean));
    let changed = true;
    while (changed) {
      changed = false;
      for (const [alias, target] of OPTION_ALIASES.entries()) {
        const a = norm(alias);
        const t = norm(target);
        if (candidates.has(a) || candidates.has(t)) {
          if (!candidates.has(a)) { candidates.add(a); changed = true; }
          if (!candidates.has(t)) { candidates.add(t); changed = true; }
        }
      }
    }
    return [...candidates];
  }

  function comparableOptionForms(value) {
    const source = norm(value);
    const forms = new Set();
    if (!source) return [];
    forms.add(source);

    // 年/月/日付きの選択肢や 01 / 1 の差を吸収する。
    const stripped = source
      .replace(/^[（(]?\s*/, '')
      .replace(/\s*[）)]?$/, '')
      .replace(/\s*(?:年|月|日)\s*$/u, '')
      .trim();
    if (stripped) forms.add(stripped);
    if (/^[+-]?\d+(?:\.0+)?$/.test(stripped)) {
      const num = Number(stripped);
      if (Number.isFinite(num)) {
        forms.add(String(num));
        if (Number.isInteger(num) && num >= 0 && num < 100) forms.add(String(num).padStart(2, '0'));
      }
    }
    return [...forms];
  }

  function selectOptionForms(option) {
    const forms = new Set();
    for (const value of [option?.textContent, option?.label, option?.getAttribute?.('aria-label')]) {
      for (const form of comparableOptionForms(value)) forms.add(form);
    }
    return [...forms];
  }

  function setSelectByText(select, desired) {
    if (!(select instanceof HTMLSelectElement) || !meaningful(desired) || !canAutofillControl(select)) return false;
    const aliasCandidates = optionCandidateNorms(String(desired));
    const candidates = new Set();
    for (const candidate of aliasCandidates) {
      for (const form of comparableOptionForms(candidate)) candidates.add(form);
    }
    const options = [...select.options];
    let option = options.find(o => selectOptionForms(o).some(form => candidates.has(form)));
    if (!option) option = options.find(o => {
      const optionForms = selectOptionForms(o);
      return optionForms.some(t => [...candidates].some(w => w.length >= 3 && (t.includes(w) || w.includes(t))));
    });
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    select.focus?.({ preventScroll: true });
    if (setter) setter.call(select, option.value);
    else select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('blur', { bubbles: true }));
    select.setAttribute(FILLED_ATTR, '1');
    return true;
  }

  function datePartKind(select) {
    if (!(select instanceof HTMLSelectElement)) return '';
    const first = norm(select.options[0]?.textContent || select.getAttribute('aria-label') || '');
    if (/(^|\b)year($|\b)|年/.test(first)) return 'year';
    if (/(^|\b)month($|\b)|月/.test(first)) return 'month';
    if (/(^|\b)day($|\b)|日/.test(first)) return 'day';

    const values = [...select.options].slice(1, 40)
      .flatMap(o => comparableOptionForms(o.textContent))
      .filter(v => /^\d+$/.test(v))
      .map(Number);
    if (!values.length) return '';
    const unique = [...new Set(values)];
    if (unique.some(v => v >= 1900 && v <= 2200)) return 'year';
    const max = Math.max(...unique);
    const min = Math.min(...unique);
    if (min >= 1 && max <= 12 && unique.length >= 6) return 'month';
    if (min >= 1 && max <= 31 && unique.length >= 13) return 'day';
    return '';
  }

  function setDateSelect(select, desired) {
    return meaningful(desired) ? setSelectByText(select, desired) : false;
  }

  function fillDateSelectGroup(selects, date, period = false) {
    if (!selects?.length || !date) return 0;
    let count = 0;
    if (period) {
      const values = [date.startYear, date.startMonth, date.endYear, date.endMonth];
      selects.slice(0, 4).forEach((sel, i) => { if (setDateSelect(sel, values[i])) count++; });
      return count;
    }

    const byKind = { year: [], month: [], day: [] };
    selects.forEach(sel => {
      const kind = datePartKind(sel);
      if (kind) byKind[kind].push(sel);
    });
    const used = new Set();
    for (const [kind, desired] of [['year', date.year], ['month', date.month], ['day', date.day]]) {
      if (!meaningful(desired)) continue;
      const sel = byKind[kind].find(x => !used.has(x));
      if (sel && setDateSelect(sel, desired)) { used.add(sel); count++; }
    }

    // プレースホルダーが独自表記でも、残った項目は年→月→日の順で補完する。
    const fallbackValues = [date.year, date.month, date.day].filter(meaningful);
    let fi = 0;
    for (const sel of selects) {
      if (used.has(sel)) continue;
      while (fi < fallbackValues.length && [...used].length > fi) fi++;
      const desired = fallbackValues[fi++];
      if (meaningful(desired) && setDateSelect(sel, desired)) { used.add(sel); count++; }
    }
    return count;
  }

  function dateDropdownGroups(scope = document) {
    const groups = [];
    const seen = new Set();
    for (const sel of [...scope.querySelectorAll('select')]) {
      if (!datePartKind(sel)) continue;
      const host = sel.closest('tr, [data-field], .field, .form-field, .application-field, .form-group, .question, fieldset') || sel.parentElement;
      if (!host || seen.has(host)) continue;
      const selects = [...host.querySelectorAll('select')].filter(s => datePartKind(s));
      if (selects.length >= 2) { seen.add(host); groups.push({ host, selects }); }
    }
    return groups;
  }

  function setChecked(input, checked = true) {
    if (!(input instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(input.type) || !canAutofillControl(input)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    if (setter) setter.call(input, !!checked);
    else input.checked = !!checked;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.setAttribute(FILLED_ATTR, '1');
    return true;
  }

  function visibleChoiceElements(scope = null) {
    const selector = '[role="radio"], [role="checkbox"], [role="switch"], [role="option"], [aria-pressed]';
    return all(selector, scope).filter(el => {
      if (el instanceof HTMLInputElement) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;
      return true;
    });
  }

  function choiceOptionText(el) {
    if (!el) return '';
    const info = labelInfo(el);
    return clean(info.radioLabel || el.getAttribute?.('aria-label') || el.getAttribute?.('data-value') || el.getAttribute?.('value') || el.textContent || '');
  }

  function splitChoiceValues(value) {
    if (Array.isArray(value)) return value.map(clean).filter(Boolean);
    if (!meaningful(value)) return [];
    if (typeof value === 'string' && /[,、;；\n]/.test(value)) return value.split(/[,、;；\n]+/).map(clean).filter(Boolean);
    return [value];
  }

  function optionMatchesDesired(optionText, desired) {
    const optionForms = new Set();
    for (const candidate of optionCandidateNorms(optionText)) {
      for (const form of comparableOptionForms(candidate)) optionForms.add(form);
    }
    const desiredForms = new Set();
    for (const candidate of optionCandidateNorms(desired)) {
      for (const form of comparableOptionForms(candidate)) desiredForms.add(form);
    }
    for (const a of optionForms) {
      for (const b of desiredForms) {
        if (a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)))) return true;
      }
    }
    return false;
  }

  function setChoiceState(el, checked = true) {
    if (!el || !canAutofillControl(el)) return false;
    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) return setChecked(el, checked);

    const role = norm(el.getAttribute?.('role'));
    const stateAttr = role === 'option' ? 'aria-selected' : (el.hasAttribute?.('aria-pressed') ? 'aria-pressed' : 'aria-checked');
    const current = el.getAttribute?.(stateAttr) === 'true';
    if (current !== !!checked) {
      try { el.click(); }
      catch (_) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    }
    el.setAttribute?.(FILLED_ATTR, '1');
    return true;
  }

  function setSelectMultipleByText(select, desiredValues) {
    if (!(select instanceof HTMLSelectElement) || !select.multiple || !canAutofillControl(select)) return false;
    const wanted = splitChoiceValues(desiredValues);
    if (!wanted.length) return false;
    let matched = 0;
    for (const option of [...select.options]) {
      const shouldSelect = wanted.some(value => optionMatchesDesired(option.textContent || option.label || '', value));
      if (option.selected !== shouldSelect) option.selected = shouldSelect;
      if (shouldSelect) matched++;
    }
    if (!matched) return false;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.setAttribute(FILLED_ATTR, '1');
    return true;
  }

  function fillControl(el, value) {
    if (!el || !meaningful(value)) return false;
    if (el instanceof HTMLSelectElement) return setSelectByText(el, value);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      const truthy = typeof value === 'boolean' ? value : /^(true|yes|y|1|はい|同意|あり)$/i.test(String(value));
      return setChecked(el, truthy);
    }
    if (el instanceof HTMLInputElement && el.type === 'radio') return false;
    if (el instanceof HTMLInputElement && el.type === 'file') return false;
    return setNativeValue(el, value);
  }

  function findRadioOption(questionRegex, desired, scope = null) {
    const radios = [
      ...visibleControls(scope).filter(el => el instanceof HTMLInputElement && el.type === 'radio'),
      ...visibleChoiceElements(scope).filter(el => norm(el.getAttribute('role')) === 'radio')
    ];
    const candidates = radios.filter(r => {
      const info = labelInfo(r);
      return questionRegex.test(info.rowLabel) || questionRegex.test(info.combined);
    });
    return candidates.find(r => splitChoiceValues(desired).some(value => optionMatchesDesired(choiceOptionText(r), value))) || null;
  }

  function fillDateRow(regex, date, { scope = document, occurrence = 0, period = false } = {}) {
    if (!date) return 0;
    const rows = rowsMatching(regex, scope);
    const row = rows[occurrence];
    if (row) {
      const dateInput = row.querySelector('input[type="date"]');
      if (dateInput && !period && date.year && date.month && date.day) {
        return setNativeValue(dateInput, `${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`) ? 1 : 0;
      }
      const selects = [...row.querySelectorAll('select')];
      if (selects.length) return fillDateSelectGroup(selects, date, period);
    }

    const host = fieldHostsMatching(regex, scope)[occurrence];
    if (host) {
      const dateInput = host.querySelector('input[type="date"]');
      if (dateInput && !period && date.year && date.month && date.day) {
        return setNativeValue(dateInput, `${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`) ? 1 : 0;
      }
      const selects = [...host.querySelectorAll('select')];
      if (selects.length) return fillDateSelectGroup(selects, date, period);
    }

    // ラベルがサイト独自でも、同一セクション内の「年/月(/日)」型プルダウン群を検出する。
    const group = dateDropdownGroups(scope)[occurrence];
    if (group) return fillDateSelectGroup(group.selects, date, period);
    return 0;
  }

  function fillNthRow(regex, occurrence, value, scope = document, controlFilter = null) {
    if (!meaningful(value)) return false;
    const rows = rowsMatching(regex, scope);
    const row = rows[occurrence];
    if (row) {
      let controls = [...row.querySelectorAll('input,select,textarea')].filter(el => !(el instanceof HTMLInputElement && ['hidden','file'].includes(el.type)));
      if (controlFilter) controls = controls.filter(controlFilter);
      if (controls[0]) return fillControl(controls[0], value);
    }
    let controls = strongControlsMatching(regex, scope, { excludeNegative: true });
    if (!controls.length) controls = controlsMatching(regex, scope, { excludeNegative: true });
    if (controlFilter) controls = controls.filter(controlFilter);
    return fillControl(controls[occurrence], value);
  }

  // 繰り返し項目では「セクション全体の文言」に引っ張られると、
  // 会社名以外の入力欄まで会社名候補として数えてしまう。
  // 行/ラベル/placeholder/近傍の短い文言だけを使う強判定を別途用意する。
  function strongControlsMatching(regex, scope = null, options = {}) {
    const { tag = null, type = null, excludeNegative = true } = options;
    return visibleControls(scope).filter(el => {
      if (tag && el.tagName.toLowerCase() !== tag) return false;
      if (type && !(el instanceof HTMLInputElement && el.type === type)) return false;
      const info = labelInfo(el);
      if (excludeNegative && SENSITIVE_NEGATIVE_RX.test(info.combined)) return false;
      const direct = clean([
        info.rowLabel, info.label, info.radioLabel, info.aria, info.placeholder,
        info.nameAttr, info.idAttr, info.dataTestId
      ].filter(Boolean).join(' | '));
      if (direct && regex.test(direct)) return true;
      return !!(info.nearText && info.nearText.length <= 180 && regex.test(info.nearText));
    });
  }

  function countEntryAnchors(anchorRegex) {
    return getRoots().reduce((total, root) => {
      const rows = rowsMatching(anchorRegex, root);
      if (rows.length) return total + rows.length;
      const controls = strongControlsMatching(anchorRegex, root).filter(el =>
        !(el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type))
      );
      return total + controls.length;
    }, 0);
  }

  function actionText(el) {
    return clean(
      el?.innerText || el?.textContent || el?.value ||
      el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || ''
    );
  }

  function findButton(regex) {
    const selector = [
      'button[hrm-append-button]', '[hrm-append-button]',
      'button', 'input[type="button"]', 'input[type="submit"]',
      'a', '[role="button"]', '[aria-pressed]', '[tabindex="0"]'
    ].join(',');
    const candidates = all(selector).filter(el => {
      if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') return false;
      const text = actionText(el);
      return !!text && text.length <= 180 && regex.test(text);
    }).map((el, index) => {
      const tag = el.tagName.toLowerCase();
      const text = actionText(el);
      let score = 0;
      if (el.hasAttribute?.('hrm-append-button')) score += 300;
      if (tag === 'button') score += 120;
      if (tag === 'input') score += 105;
      if (el.getAttribute?.('role') === 'button') score += 95;
      if (tag === 'a') score += 70;
      if (el.tabIndex >= 0) score += 20;
      if (clean(el.getAttribute?.('aria-label'))) score += 10;
      score -= Math.min(80, Math.max(0, text.length - 24));
      return { el, score, index };
    });
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    return candidates[0]?.el || null;
  }

  async function waitForEntryGrowth(anchorRegex, before, timeoutMs = 1800) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(80);
      const current = countEntryAnchors(anchorRegex);
      if (current > before) return current;
    }
    return countEntryAnchors(anchorRegex);
  }

  async function ensureEntryCount(anchorRegex, buttonRegex, count) {
    if (!count || count < 1) return;
    for (let guard = 0; guard < Math.min(16, count + 5); guard++) {
      const current = countEntryAnchors(anchorRegex);
      if (current >= count) break;
      const button = findButton(buttonRegex);
      if (!button) break;
      try {
        button.click();
      } catch (_) {
        try {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
      }
      const grown = await waitForEntryGrowth(anchorRegex, current);
      if (grown <= current) break;
    }
  }

  function questionMatches(text, rule) {
    const source = clean(text);
    if (!source || !rule?.match) return false;
    const mode = rule.mode || 'regex';
    if (mode === 'exact') return norm(source) === norm(rule.match);
    if (mode === 'includes') return norm(source).includes(norm(rule.match));
    try { return new RegExp(rule.match, 'i').test(source); }
    catch (_) { return norm(source).includes(norm(rule.match)); }
  }

  function setCustomAnswer(rule) {
    if (!rule || !meaningful(rule.value) || !rule.match) return 0;
    const isConsent = text => /(recruitment privacy policy|privacy policy|handling of personal information|個人情報.*(取扱|取り扱|同意)|プライバシー.*同意)/i.test(clean(text));
    const choiceSelector = 'input,select,textarea,[role="radio"],[role="checkbox"],[role="switch"],[role="option"],[aria-pressed]';
    const rows = all('tr').filter(row => {
      const text = clean(row.innerText).slice(0, 260);
      if (isConsent(text)) return false;
      return questionMatches(rowLabel(row), rule) || questionMatches(text, rule);
    });
    const groups = rows.map(row => [...row.querySelectorAll(choiceSelector)])
      .filter(group => group.length);

    // 表形式でない企業独自項目にも対応。共通コンテナが見つかれば選択肢をまとめて扱う。
    if (!groups.length) {
      const candidates = [...visibleControls(), ...visibleChoiceElements()];
      const addedHosts = new Set();
      for (const el of candidates) {
        const info = labelInfo(el);
        const directQuestionText = clean([
          info.rowLabel, info.label, info.radioLabel, info.aria, info.placeholder,
          info.nameAttr, info.idAttr, info.dataTestId, info.nearText
        ].filter(Boolean).join(' | '));
        if (isConsent(info.combined) || !questionMatches(directQuestionText, rule)) continue;
        const host = fieldContainer(el) || el.parentElement;
        if (host && !addedHosts.has(host)) {
          const hostControls = [...host.querySelectorAll(choiceSelector)];
          if (hostControls.length) {
            groups.push(hostControls);
            addedHosts.add(host);
            continue;
          }
        }
        groups.push([el]);
      }
    }

    let count = 0;
    const seen = new Set();
    const desiredValues = splitChoiceValues(rule.value);
    for (const group of groups) {
      const controls = group.filter(el => {
        if (seen.has(el)) return false;
        seen.add(el);
        return !(el instanceof HTMLInputElement && ['hidden','file'].includes(el.type));
      });
      if (!controls.length) continue;

      const radios = controls.filter(el =>
        (el instanceof HTMLInputElement && el.type === 'radio') || norm(el.getAttribute?.('role')) === 'radio');
      const checks = controls.filter(el =>
        (el instanceof HTMLInputElement && el.type === 'checkbox')
        || ['checkbox','switch'].includes(norm(el.getAttribute?.('role')))
        || el.hasAttribute?.('aria-pressed'));
      const roleOptions = controls.filter(el => norm(el.getAttribute?.('role')) === 'option');
      const selects = controls.filter(el => el instanceof HTMLSelectElement);
      const textLike = controls.find(el =>
        !(el instanceof HTMLInputElement && ['radio','checkbox'].includes(el.type))
        && !(el instanceof HTMLSelectElement)
        && !['radio','checkbox','switch','option'].includes(norm(el.getAttribute?.('role')))
        && !el.hasAttribute?.('aria-pressed'));

      if (radios.length) {
        const target = radios.find(r => desiredValues.some(value => optionMatchesDesired(choiceOptionText(r), value)));
        if (target && setChoiceState(target, true)) count++;
        continue;
      }

      if (checks.length) {
        if (typeof rule.value === 'boolean') {
          if (setChoiceState(checks[0], rule.value)) count++;
          continue;
        }
        for (const c of checks) {
          if (desiredValues.some(value => optionMatchesDesired(choiceOptionText(c), value))) {
            if (setChoiceState(c, true)) count++;
          }
        }
        continue;
      }

      if (roleOptions.length) {
        for (const option of roleOptions) {
          if (desiredValues.some(value => optionMatchesDesired(choiceOptionText(option), value))) {
            if (setChoiceState(option, true)) count++;
            if (desiredValues.length === 1) break;
          }
        }
        continue;
      }

      if (selects.length) {
        const select = selects[0];
        if (select.multiple && setSelectMultipleByText(select, desiredValues)) { count++; continue; }
        if (setSelectByText(select, desiredValues[0])) { count++; continue; }
      }

      if (textLike && fillControl(textLike, rule.value)) { count++; continue; }
    }
    return count;
  }

  function inputByPlaceholderRegex(regex, type = null) {
    return all('input').find(el => (!type || el.type === type) && regex.test(clean(el.placeholder || ''))) || null;
  }

  function fillFormPreferences(preferences = {}) {
    let count = 0;
    const preferredLocations = [
      ...splitChoiceValues(preferences.preferredLocation),
      ...(Array.isArray(preferences.otherLocations) ? preferences.otherLocations.map(clean).filter(Boolean) : [])
    ];
    const uniquePreferredLocations = [...new Set(preferredLocations)];
    const rules = [
      uniquePreferredLocations.length ? { match: '勤務希望拠点|希望勤務地|勤務地.*希望|希望.*勤務地|preferred\s*(?:work\s*)?locations?', value: uniquePreferredLocations.length === 1 ? uniquePreferredLocations[0] : uniquePreferredLocations } : null,
      Array.isArray(preferences.otherLocations) && preferences.otherLocations.length ? { match: 'その他勤務可能拠点|その他.*勤務地|other.*(?:work\s*)?locations?', value: preferences.otherLocations } : null,
      preferences.requestNotes ? { match: '希望記入欄|希望条件|your\s*other\s*wishes', value: preferences.requestNotes } : null,
      preferences.attachmentUrls ? { match: 'URL記載欄|添付.*URL|additional.*URL', value: preferences.attachmentUrls } : null,
      preferences.priorContact ? { match: '過去.*連絡|連絡.*有無|prior.*contact', value: preferences.priorContact } : null
    ].filter(Boolean);
    for (const rule of rules) count += setCustomAnswer(rule);

    if (meaningful(preferences.salaryType)) {
      const select = bestControl(RX.currentSalary, { tag: 'select', optionRegex: /(hourly|daily|monthly|annual|時給|日給|月給|年収|年俸)/i });
      if (setSelectByText(select, preferences.salaryType)) count++;
    }
    if (meaningful(preferences.salaryAmount)) {
      const input = bestControl(RX.currentSalary, { tag: 'input', placeholderRegex: /(yen|円|million|万円|1000)/i })
        || inputByPlaceholderRegex(/1000円|1,?000\s*yen|3\s*million/i);
      if (fillControl(input, preferences.salaryAmount)) count++;
    }
    return count;
  }

  function parseStoredValue(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (_) { return null; }
    }
    return value;
  }

  function newProfileId() {
    try { return crypto.randomUUID(); }
    catch (_) { return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
  }

  function emptyProfile() {
    const walk = value => {
      if (Array.isArray(value)) return [];
      if (value && typeof value === 'object') {
        const result = {};
        for (const [key, child] of Object.entries(value)) result[key] = walk(child);
        return result;
      }
      if (typeof value === 'boolean') return false;
      return '';
    };
    const blank = walk(DEFAULT_PROFILE);
    blank.education = [];
    blank.workExperience = [];
    blank.certifications = [];
    blank.customAnswers = [];
    blank.formPreferences.otherLocations = [];
    return blank;
  }

  function normalizeProfileData(data) {
    return deepMerge(structuredClone(DEFAULT_PROFILE), data && typeof data === 'object' ? data : {});
  }

  function normalizeEditorSettings(settings = {}) {
    return {
      // 新しい職歴はデフォルトで先頭へ追加し、既存の職歴1以降を1つずつ後ろへ送ります。
      // append を選ぶと v4.0 までと同じ末尾追加になります。
      workAddPosition: settings?.workAddPosition === 'append' ? 'append' : 'prepend',
      inputMode: settings?.inputMode === 'required' ? 'required' : 'all'
    };
  }

  function getInputMode() { return normalizeEditorSettings(getProfileStore().settings).inputMode; }
  function inputModeLabel(mode = getInputMode()) { return mode === 'required' ? '必須項目のみ' : '入力可能な項目'; }
  function setInputMode(mode) {
    const store = getProfileStore();
    store.settings = normalizeEditorSettings({ ...store.settings, inputMode: mode });
    saveProfileStore(store);
    syncPanelInputMode();
    updateStatus(null);
    return store.settings.inputMode;
  }

  function makeDefaultStore(data = null) {
    const id = newProfileId();
    return {
      version: 4,
      activeId: id,
      settings: normalizeEditorSettings(),
      profiles: [{ id, name: 'メインプロフィール', data: normalizeProfileData(data || DEFAULT_PROFILE) }]
    };
  }

  function normalizeProfileStore(raw) {
    if (!raw || !Array.isArray(raw.profiles) || !raw.profiles.length) return makeDefaultStore();
    const seen = new Set();
    const profiles = raw.profiles.map((record, index) => {
      let id = clean(record?.id) || newProfileId();
      if (seen.has(id)) id = newProfileId();
      seen.add(id);
      return {
        id,
        name: clean(record?.name) || `プロフィール ${index + 1}`,
        data: normalizeProfileData(record?.data)
      };
    });
    const activeId = profiles.some(p => p.id === raw.activeId) ? raw.activeId : profiles[0].id;
    return { version: 4, activeId, settings: normalizeEditorSettings(raw.settings), profiles };
  }

  function getProfileStore() {
    try {
      const current = parseStoredValue(GM_getValue(STORAGE_KEY, ''));
      if (current) return normalizeProfileStore(current);

      // 公開版は初回起動時に空のプロフィールを作成します。
      // 他版の保存済みプロフィールを自動取り込みしないため、意図しない個人情報の継承を避けます。
      const initial = makeDefaultStore();
      saveProfileStore(initial);
      return initial;
    } catch (e) {
      console.warn('[求人応募入力支援] プロフィール読込に失敗:', e);
      return makeDefaultStore();
    }
  }

  function saveProfileStore(store) {
    const normalized = normalizeProfileStore(store);
    GM_setValue(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function activeProfileRecord(store = null) {
    const s = store || getProfileStore();
    return s.profiles.find(p => p.id === s.activeId) || s.profiles[0];
  }

  function getProfile() {
    return structuredClone(activeProfileRecord().data);
  }

  function getActiveProfileName() {
    return activeProfileRecord().name;
  }

  function setActiveProfile(id) {
    const store = getProfileStore();
    if (!store.profiles.some(p => p.id === id)) return false;
    store.activeId = id;
    saveProfileStore(store);
    syncPanelProfileSelect();
    updateStatus(null);
    return true;
  }

  function saveProfile(profile) {
    const store = getProfileStore();
    const record = activeProfileRecord(store);
    record.data = normalizeProfileData(profile);
    saveProfileStore(store);
  }

  function deepMerge(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value)) base[key] = value;
      else if (value && typeof value === 'object') {
        if (!base[key] || typeof base[key] !== 'object' || Array.isArray(base[key])) base[key] = {};
        deepMerge(base[key], value);
      } else base[key] = value;
    }
    return base;
  }

  function countFilled() {
    return all(`[${FILLED_ATTR}="1"]`).length;
  }

  function isEmptyControl(el) {
    if (el instanceof HTMLSelectElement) return el.selectedIndex <= 0 || !clean(el.options[el.selectedIndex]?.textContent);
    if (el instanceof HTMLInputElement && ['radio','checkbox'].includes(el.type)) return !el.checked;
    if (el instanceof HTMLInputElement && el.type === 'file') return !el.files?.length;
    return !clean(el.value);
  }

  function requiredRowsStillEmpty() {
    const result = [];
    const seen = new Set();
    for (const el of visibleControls()) {
      const info = labelInfo(el);
      const hostText = clean(info.container?.innerText || info.container?.textContent || info.combined);
      const required = isRequiredControl(el);
      if (!required) continue;
      const host = info.container || el;
      if (seen.has(host)) continue;
      seen.add(host);
      const controls = [...host.querySelectorAll?.('input,select,textarea') || [el]].filter(c => !(c instanceof HTMLInputElement && c.type === 'hidden'));
      const radios = controls.filter(c => c instanceof HTMLInputElement && c.type === 'radio');
      const checks = controls.filter(c => c instanceof HTMLInputElement && c.type === 'checkbox');
      let empty;
      if (radios.length) empty = !radios.some(r => r.checked);
      else if (checks.length && controls.every(c => c instanceof HTMLInputElement && c.type === 'checkbox')) empty = !checks.some(c => c.checked);
      else empty = controls.every(isEmptyControl);
      if (empty) result.push(info.rowLabel || info.label || info.aria || info.placeholder || hostText.slice(0, 90));
    }
    return [...new Set(result)].filter(Boolean);
  }

  function highlightManualItems() {
    for (const el of all(`.${HIGHLIGHT_CLASS}`)) el.classList.remove(HIGHLIGHT_CLASS);
    for (const file of all('input[type="file"]')) {
      const host = file.closest('app-custom-form-fileupload-item, tr, app-card-section, fieldset, .field, .form-field, .application-field, div');
      host?.classList.add(HIGHLIGHT_CLASS);
    }
    for (const el of all('input[type="checkbox"], input[type="radio"], select')) {
      const info = labelInfo(el);
      if (/(recruitment privacy policy|privacy policy|個人情報|プライバシー|同意|consent)/i.test(info.combined)) {
        (info.container || el).classList?.add(HIGHLIGHT_CLASS);
      }
    }
  }

  function deriveNameParts(basic = {}) {
    if (meaningful(basic.firstName) || meaningful(basic.lastName)) return { firstName: basic.firstName || '', lastName: basic.lastName || '' };
    const parts = clean(basic.name).split(' ').filter(Boolean);
    if (parts.length >= 2) return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
    return { firstName: basic.name || '', lastName: '' };
  }

  function normalizedNameLabel(value) {
    return clean(value)
      .normalize('NFKC')
      .replace(/\brequired\b/gi, ' ')
      .replace(/必須|任意|optional/gi, ' ')
      .replace(/[※*＊]/g, ' ')
      .replace(/漢字|kanji/gi, ' ')
      .replace(/[（(\[【].*?[）)\]】]/g, ' ')
      .replace(/[：:/｜|・]/g, ' ')
      .replace(/[\s　]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isJapaneseNamePartLabel(value, part) {
    if (!value || NAME_PHONETIC_RX.test(value)) return false;
    return normalizedNameLabel(value) === part;
  }

  function scoreNameControl(el, kind) {
    if (!(el instanceof HTMLInputElement) || ['hidden','file','radio','checkbox','submit','button','reset'].includes(el.type)) return -Infinity;
    const info = labelInfo(el);
    if (SENSITIVE_NEGATIVE_RX.test(info.combined)) return -Infinity;

    // フリガナ・カナ欄へ漢字を入れる事故を最優先で防止する。
    const phonetic = NAME_PHONETIC_RX.test(clean([info.rowLabel, info.label, info.aria, info.placeholder, info.nearText].join(' ')));
    if (phonetic) return -Infinity;

    const sources = [
      [info.rowLabel, 120], [info.label, 118], [info.aria, 105],
      [info.placeholder, 82], [info.nameAttr, 90], [info.idAttr, 88],
      [info.dataTestId, 84], [info.nearText, 46]
    ];
    let score = 0;
    const auto = norm(info.autocomplete);
    const attrText = norm([info.nameAttr, info.idAttr, info.dataTestId].join(' '));

    if (kind === 'full') {
      if (auto === 'name') score += 220;
      if (/(^|[\s_-])(full|legal|applicant|candidate)[\s_-]*name($|[\s_-])/i.test(attrText)) score += 150;
      if (/^(name|full[\s_-]*name)$/i.test(attrText)) score += 115;
      if (/^(?:例[）)]?\s*)?[\p{Script=Han}々〆ヶ]{1,12}[\s　]+[\p{Script=Han}々〆ヶ]{1,12}$/u.test(clean(info.placeholder))) score += 105;
      for (const [text, weight] of sources) {
        if (!text) continue;
        if (/(氏名|姓名|お名前|フルネーム|名前\s*[（(]?\s*漢字|full\s*name|legal\s*name|applicant\s*name|candidate\s*name)/i.test(text)) score += weight;
        // 単純な Name はラベル等の短いソースだけを対象にする。
        if (/^\s*name\s*(?:required|必須|[*＊])?\s*$/i.test(clean(text))) score += weight;
      }
      if (/(^|[\s_-])(first|given|last|family|surname)[\s_-]*name($|[\s_-])/i.test(attrText)) score -= 220;
      if (sources.some(([text]) => isJapaneseNamePartLabel(text, '姓') || isJapaneseNamePartLabel(text, '名'))) score -= 220;
    } else if (kind === 'first') {
      if (auto === 'given-name') score += 240;
      if (/(first|given)[\s_-]*name/i.test(attrText)) score += 175;
      for (const [text, weight] of sources) {
        if (!text) continue;
        if (/(first\s*name|given\s*name|legal\s*first\s*name|preferred\s*first\s*name)/i.test(text)) score += weight;
        if (isJapaneseNamePartLabel(text, '名')) score += weight + 35;
      }
      if (/(last|family|surname)[\s_-]*name/i.test(attrText)) score -= 240;
      if (sources.some(([text]) => isJapaneseNamePartLabel(text, '姓'))) score -= 240;
      if (sources.some(([text]) => /(氏名|姓名|フルネーム)/.test(clean(text)))) score -= 150;
    } else if (kind === 'last') {
      if (auto === 'family-name') score += 240;
      if (/(last|family|surname)[\s_-]*name/i.test(attrText)) score += 175;
      for (const [text, weight] of sources) {
        if (!text) continue;
        if (/(last\s*name|family\s*name|surname|legal\s*last\s*name|preferred\s*last\s*name)/i.test(text)) score += weight;
        if (isJapaneseNamePartLabel(text, '姓') || /^(苗字|名字)(?:\s*(?:required|必須|[*＊]))?$/i.test(clean(text))) score += weight + 35;
      }
      if (/(first|given)[\s_-]*name/i.test(attrText)) score -= 240;
      if (sources.some(([text]) => isJapaneseNamePartLabel(text, '名'))) score -= 240;
      if (sources.some(([text]) => /(氏名|姓名|フルネーム)/.test(clean(text)))) score -= 150;
    }
    return score;
  }

  function bestNameControl(kind) {
    const scored = visibleControls()
      .map((el, index) => ({ el, index, score: scoreNameControl(el, kind) }))
      .filter(x => Number.isFinite(x.score) && x.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return scored[0]?.el || null;
  }

  function fillNameControl(kind, value) {
    if (!meaningful(value)) return false;
    const el = bestNameControl(kind);
    if (!el) return false;
    const ok = setNativeValue(el, value);
    // React/Vue等のcontrolled inputが直後に空へ戻すケースへ一度だけ追従する。
    if (ok) {
      const expected = String(value);
      setTimeout(() => {
        try {
          if (el.isConnected && clean(el.value) === '' && expected) setNativeValue(el, expected);
        } catch (_) {}
      }, 80);
    }
    return ok;
  }

  function fillGenericProfileFields(profile) {
    let count = 0;
    const b = profile.basic || {};
    const names = deriveNameParts(b);
    if (fillNameControl('first', names.firstName)) count++;
    if (fillNameControl('last', names.lastName)) count++;
    const generic = [
      [RX.country, b.country, { autocompleteRegex: /^country/i }],
      [RX.state, b.state, { autocompleteRegex: /address-level1/i }],
      [RX.city, b.city, { autocompleteRegex: /address-level2/i }],
      [RX.github, profile.links?.github, {}],
      [RX.linkedin, profile.links?.linkedin, {}],
      [RX.portfolio, profile.links?.portfolio, {}],
      [RX.website, profile.links?.website, {}],
      [RX.selfPR, profile.selfPR, { tag: 'textarea', negativeRegex: /(privacy|consent|個人情報|プライバシー)/i }]
    ];
    for (const [rx, value, opts] of generic) {
      if (!meaningful(value)) continue;
      const el = bestControl(rx, opts);
      if (fillControl(el, value)) count++;
    }
    return count;
  }

  function shouldExpandRepeatSection(anchorRegex) {
    if (!isRequiredOnlyMode()) return true;
    const anchors = strongControlsMatching(anchorRegex).filter(el =>
      !(el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type))
    );
    return anchors.some(isRequiredControl);
  }

  async function autofill() {
    const previousMode = activeAutofillInputMode;
    activeAutofillInputMode = getInputMode();
    try { return await autofillCore(); }
    finally { activeAutofillInputMode = previousMode; }
  }

  async function autofillCore() {
    const profile = getProfile();
    const before = countFilled();
    let attempts = 0;

    const education = (profile.education || []).filter(x => Object.values(x || {}).some(meaningful));
    const work = (profile.workExperience || []).filter(x => Object.entries(x || {}).some(([k,v]) => k === 'currentlyWorking' ? v === true : meaningful(v)));
    const certs = (profile.certifications || []).filter(x => Object.values(x || {}).some(meaningful));

    if (shouldExpandRepeatSection(RX.school)) await ensureEntryCount(RX.school, /(add\s*(another\s*)?education|学歴.*追加|学歴を追加)/i, education.length);
    if (shouldExpandRepeatSection(RX.company)) await ensureEntryCount(RX.company, /(add\s*(another\s*)?(work\s*)?(experience|employment(?:\s*history)?|career)|職歴.*追加|職歴を追加|経歴.*追加|勤務歴.*追加)/i, work.length);
    if (shouldExpandRepeatSection(RX.qualification)) await ensureEntryCount(RX.qualification, /(add\s*(another\s*)?(licenses?\/?\s*certifications?|certifications?|qualification)|資格.*追加|資格を追加)/i, certs.length);

    const b = profile.basic || {};
    // 漢字氏名は日本語ラベルの括弧表記や「必須」が付くケースを専用判定する。
    if (fillNameControl('full', b.name)) attempts++;
    const simple = [
      [RX.furigana, b.furigana, { placeholderRegex: /たなか|furigana|ふりがな/i }],
      [RX.email, b.email, { tag: 'input', placeholderRegex: /email/i, autocompleteRegex: /^email$/i }],
      [RX.phone, b.phone, { tag: 'input', placeholderRegex: /phone|tel/i, autocompleteRegex: /^tel/i }],
      [RX.postal, b.postalCode, { tag: 'input', placeholderRegex: /\d{3}-?\d{4}|postal|postcode|zip/i, autocompleteRegex: /postal-code/i }],
      [RX.preferredContact, b.preferredContactPeriod, {}],
      [RX.availableStart, b.availableStartDate, {}],
      [RX.workNotes, profile.workNotes, { tag: 'textarea' }],
      [RX.wishes, profile.wishes, { tag: 'textarea' }],
      [RX.message, profile.message, { tag: 'textarea' }]
    ];
    for (const [rx, value, opts] of simple) {
      if (!meaningful(value)) continue;
      const el = bestControl(rx, opts);
      if (fillControl(el, value)) attempts++;
    }

    attempts += fillGenericProfileFields(profile);

    if (meaningful(b.address1) || meaningful(b.address2)) {
      const jp1 = inputByPlaceholderRegex(/東京都|渋谷区渋谷|番地|丁目|住所1/i);
      const jp2 = inputByPlaceholderRegex(/クロスタワー|建物|マンション|アパート|部屋|住所2/i);
      const en1 = inputByPlaceholderRegex(/12\/f|crosstower|street/i);
      const en2 = inputByPlaceholderRegex(/shibuya-ku|tokyo,? japan|city.*country/i);

      if (jp1 || jp2) {
        if (fillControl(jp1 || bestControl(RX.address, { tag: 'input' }), b.address1)) attempts++;
        if (fillControl(jp2, b.address2)) attempts++;
      } else if (en1 || en2) {
        const line1 = meaningful(b.addressEnglish1) ? b.addressEnglish1 : clean([b.address1, b.address2].filter(meaningful).join(' '));
        const line2 = meaningful(b.addressEnglish2) ? b.addressEnglish2 : '';
        if (fillControl(en1 || bestControl(RX.address, { tag: 'input' }), line1)) attempts++;
        if (fillControl(en2, line2)) attempts++;
      } else {
        const candidates = all('input').filter(el => RX.address.test(labelInfo(el).combined) || /street-address|address-line[12]/i.test(el.autocomplete || ''));
        if (fillControl(candidates[0], b.address1)) attempts++;
        if (fillControl(candidates[1], b.address2)) attempts++;
      }
    }

    if (b.birth && Object.values(b.birth).some(meaningful)) attempts += fillDateRow(RX.birth, b.birth);
    if (meaningful(b.sex)) {
      const radio = findRadioOption(RX.sex, b.sex);
      if (radio && setChoiceState(radio, true)) attempts++;
    }

    if (education.length) {
      const scope = sectionForAnchor(RX.school);
      education.forEach((ed, i) => {
        if (fillNthRow(RX.school, i, ed.schoolName, scope)) attempts++;
        if (fillNthRow(RX.fieldStudy, i, ed.fieldOfStudy, scope)) attempts++;
        if (fillNthRow(RX.educationLevel, i, ed.level, scope)) attempts++;
        const period = { startYear: ed.startYear, startMonth: ed.startMonth, endYear: ed.endYear, endMonth: ed.endMonth };
        if (Object.values(period).some(meaningful)) attempts += fillDateRow(RX.duration, period, { scope, occurrence: i, period: true });
      });
    }

    if (work.length) {
      const scope = sectionForAnchor(RX.company);
      work.forEach((wk, i) => {
        if (fillNthRow(RX.company, i, wk.companyName, scope)) attempts++;
        if (fillNthRow(RX.departmentTitle, i, wk.departmentTitle, scope)) attempts++;
        if (fillNthRow(RX.occupation, i, wk.occupation, scope)) attempts++;
        if (fillNthRow(RX.employmentType, i, wk.employmentType, scope)) attempts++;
        const period = { startYear: wk.startYear, startMonth: wk.startMonth, endYear: wk.endYear, endMonth: wk.endMonth };
        if (Object.values(period).some(meaningful)) attempts += fillDateRow(RX.duration, period, { scope, occurrence: i, period: true });
        if (wk.currentlyWorking) {
          const checks = [...scope.querySelectorAll('input[type="checkbox"]')].filter(c => /currently\s*working|在職中|現在.*勤務/i.test(labelInfo(c).combined));
          if (checks[i] && setChecked(checks[i], true)) attempts++;
        }
        if (fillNthRow(RX.responsibilities, i, wk.responsibilities, scope)) attempts++;
      });
    }

    if (certs.length) {
      const scope = sectionForAnchor(RX.qualification);
      certs.forEach((cert, i) => {
        const issue = { year: cert.issueYear, month: cert.issueMonth, day: '' };
        if (Object.values(issue).some(meaningful)) attempts += fillDateRow(RX.issueDate, issue, { scope, occurrence: i });
        if (fillNthRow(RX.qualification, i, cert.name, scope)) attempts++;
      });
    }

    if (profile.salary) {
      if (meaningful(profile.salary.type)) {
        const select = bestControl(RX.currentSalary, { tag: 'select', optionRegex: /(hourly|daily|monthly|annual|時給|月給|年収)/i });
        if (setSelectByText(select, profile.salary.type)) attempts++;
      }
      if (meaningful(profile.salary.amount)) {
        const amount = bestControl(RX.currentSalary, { tag: 'input', placeholderRegex: /(yen|円|million|万円)/i })
          || all('input').find(el => /(yen|円|million|万円)/i.test(el.placeholder || ''));
        if (fillControl(amount, profile.salary.amount)) attempts++;
      }
    }

    let customCount = 0;
    customCount += fillFormPreferences(profile.formPreferences || {});
    for (const rule of profile.customAnswers || []) customCount += setCustomAnswer(rule);

    await sleep(80);
    highlightManualItems();
    const required = requiredRowsStillEmpty();
    const after = countFilled();
    lastReport = { filled: Math.max(0, after - before), attempts, customCount, required };
    updateStatus(lastReport);
    return lastReport;
  }

  function scanForm() {
    const rows = [];
    for (const el of visibleControls()) {
      const info = labelInfo(el);
      rows.push({
        種類: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
        項目: info.rowLabel || info.label || info.radioLabel || info.placeholder || '(判定不能)',
        補助情報: info.placeholder || info.section || '',
        選択肢: el instanceof HTMLSelectElement ? [...el.options].map(o => clean(o.textContent)).slice(0, 16).join(' / ') : '',
        現在値: el instanceof HTMLInputElement && ['radio','checkbox'].includes(el.type) ? (el.checked ? '選択済み' : '') : clean(el.value)
      });
    }
    console.table(rows);
    const required = requiredRowsStillEmpty();
    lastReport = { scanned: rows.length, required, fileCount: all('input[type="file"]').length };
    highlightManualItems();
    updateStatus(lastReport);
    return rows;
  }

  function statusText(report) {
    const profileName = getActiveProfileName();
    const mode = inputModeLabel();
    if (!report) return `${SITE.name} / ${profileName}［${mode}］：内容を確認して「入力」を押してください。`;
    if ('scanned' in report) {
      return `${SITE.name} / ${profileName}［${mode}］：項目 ${report.scanned} 件を確認。未入力の必須候補 ${report.required.length} 件。`;
    }
    return `${SITE.name} / ${profileName}［${mode}］：入力 ${report.filled} 件、独自回答 ${report.customCount} 件。未入力の必須候補 ${report.required.length} 件。`;
  }

  function updateStatus(report) {
    const el = document.querySelector(`#${PANEL_ID} .hrmos-af-status`);
    if (el) el.textContent = statusText(report);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function deepSet(target, path, value) {
    const parts = String(path).split('.');
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const next = parts[i + 1];
      if (node[key] == null || typeof node[key] !== 'object') node[key] = /^\d+$/.test(next) ? [] : {};
      node = node[key];
    }
    node[parts.at(-1)] = value;
  }

  function fieldHtml(label, path, value, options = {}) {
    const type = options.type || 'text';
    const hint = options.hint ? `<small>${escapeHtml(options.hint)}</small>` : '';
    const placeholder = options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : '';
    const cls = options.wide ? ' wide' : '';
    if (type === 'textarea') {
      return `<label class="editor-field${cls}"><span>${escapeHtml(label)}</span>${hint}<textarea data-path="${escapeHtml(path)}"${placeholder}>${escapeHtml(value)}</textarea></label>`;
    }
    if (type === 'select') {
      const choices = options.choices || [];
      const opts = choices.map(choice => {
        const item = typeof choice === 'string' ? { value: choice, label: choice || '未設定' } : choice;
        return `<option value="${escapeHtml(item.value)}"${String(item.value) === String(value ?? '') ? ' selected' : ''}>${escapeHtml(item.label)}</option>`;
      }).join('');
      return `<label class="editor-field${cls}"><span>${escapeHtml(label)}</span>${hint}<select data-path="${escapeHtml(path)}">${opts}</select></label>`;
    }
    if (type === 'checkbox') {
      return `<label class="editor-check${cls}"><input type="checkbox" data-path="${escapeHtml(path)}"${value ? ' checked' : ''}><span>${escapeHtml(label)}</span>${hint}</label>`;
    }
    return `<label class="editor-field${cls}"><span>${escapeHtml(label)}</span>${hint}<input type="${escapeHtml(type)}" data-path="${escapeHtml(path)}" value="${escapeHtml(value)}"${placeholder}></label>`;
  }

  function editorCard(title, body, controls = '', attrs = '') {
    return `<section class="editor-card"${attrs ? ` ${attrs}` : ''}><div class="editor-card-head"><strong>${escapeHtml(title)}</strong>${controls}</div><div class="editor-grid">${body}</div></section>`;
  }

  function reorderControls(key, index, count, removeLabel = '削除') {
    const upDisabled = index <= 0 ? ' disabled' : '';
    const downDisabled = index >= count - 1 ? ' disabled' : '';
    return `<div class="reorder-controls">
      <button type="button" class="reorder-handle" data-reorder-handle aria-label="ドラッグして並べ替え。上下矢印キーでも移動できます" title="ドラッグして並べ替え（上下矢印キー対応）">⋮⋮</button>
      <button type="button" class="reorder-step" data-reorder-move="-1" aria-label="1つ上へ移動" title="1つ上へ移動"${upDisabled}>↑</button>
      <button type="button" class="reorder-step" data-reorder-move="1" aria-label="1つ下へ移動" title="1つ下へ移動"${downDisabled}>↓</button>
      <button type="button" class="danger subtle" data-remove-array="${escapeHtml(key)}" data-index="${index}">${escapeHtml(removeLabel)}</button>
    </div>`;
  }

  function reorderHelp(label) {
    return `<div class="editor-help reorder-help"><strong>${escapeHtml(label)}の並べ替え:</strong> 「⋮⋮」をドラッグするか、↑ / ↓ ボタンで移動できます。ハンドルにフォーカスして ↑ / ↓ キーでも移動できます。</div>`;
  }

  function renderBasicTab(profile) {
    const b = profile.basic || {};
    return `
      <div class="editor-help">氏名は「フルネーム」と「姓・名」を両方登録しておくと、サイトごとの入力形式に対応しやすくなります。</div>
      ${editorCard('氏名・連絡先', [
        fieldHtml('氏名（漢字・フルネーム）', 'basic.name', b.name),
        fieldHtml('姓（漢字）', 'basic.lastName', b.lastName),
        fieldHtml('名（漢字）', 'basic.firstName', b.firstName),
        fieldHtml('ふりがな', 'basic.furigana', b.furigana),
        fieldHtml('性別', 'basic.sex', b.sex, { type: 'select', choices: ['', '男性', '女性', 'その他'] }),
        fieldHtml('メールアドレス', 'basic.email', b.email, { type: 'email' }),
        fieldHtml('電話番号', 'basic.phone', b.phone, { type: 'tel' })
      ].join(''))}
      ${editorCard('生年月日', [
        fieldHtml('年', 'basic.birth.year', b.birth?.year, { placeholder: '2000' }),
        fieldHtml('月', 'basic.birth.month', b.birth?.month, { placeholder: '2' }),
        fieldHtml('日', 'basic.birth.day', b.birth?.day, { placeholder: '4' })
      ].join(''))}
      ${editorCard('応募時期・連絡', [
        fieldHtml('連絡希望時間帯', 'basic.preferredContactPeriod', b.preferredContactPeriod, { wide: true }),
        fieldHtml('入社可能時期', 'basic.availableStartDate', b.availableStartDate, { wide: true })
      ].join(''))}`;
  }

  function renderAddressTab(profile) {
    const b = profile.basic || {};
    return `
      <div class="editor-help">日本語フォーム用の住所と、英語UIで分割される住所の両方を設定できます。空欄は入力しません。</div>
      ${editorCard('日本語住所', [
        fieldHtml('郵便番号', 'basic.postalCode', b.postalCode),
        fieldHtml('住所1', 'basic.address1', b.address1, { wide: true }),
        fieldHtml('住所2（建物・部屋番号）', 'basic.address2', b.address2, { wide: true })
      ].join(''))}
      ${editorCard('分割住所・英語UI', [
        fieldHtml('国', 'basic.country', b.country),
        fieldHtml('都道府県 / State', 'basic.state', b.state),
        fieldHtml('市区町村 / City', 'basic.city', b.city),
        fieldHtml('町名番地 / Street', 'basic.streetAddress', b.streetAddress),
        fieldHtml('建物・部屋番号', 'basic.building', b.building),
        fieldHtml('英語住所1', 'basic.addressEnglish1', b.addressEnglish1, { wide: true }),
        fieldHtml('英語住所2', 'basic.addressEnglish2', b.addressEnglish2, { wide: true })
      ].join(''))}`;
  }

  function renderEducationTab(profile) {
    const items = profile.education || [];
    const cards = items.map((ed, i) => editorCard(`学歴 ${i + 1}`, [
      fieldHtml('学校名', `education.${i}.schoolName`, ed.schoolName, { wide: true }),
      fieldHtml('学部・学科・専攻', `education.${i}.fieldOfStudy`, ed.fieldOfStudy, { wide: true }),
      fieldHtml('学位・学歴区分', `education.${i}.level`, ed.level),
      fieldHtml('開始年', `education.${i}.startYear`, ed.startYear),
      fieldHtml('開始月', `education.${i}.startMonth`, ed.startMonth),
      fieldHtml('終了年', `education.${i}.endYear`, ed.endYear),
      fieldHtml('終了月', `education.${i}.endMonth`, ed.endMonth)
    ].join(''), reorderControls('education', i, items.length), `data-reorder-key="education" data-index="${i}"`)).join('');
    return `${reorderHelp('学歴')}${cards || '<div class="editor-empty">学歴はまだ登録されていません。</div>'}<button type="button" class="add-row" data-add="education">＋ 学歴を追加</button>`;
  }

  function renderWorkTab(profile, store = null) {
    const items = profile.workExperience || [];
    const addPosition = normalizeEditorSettings(store?.settings).workAddPosition;
    const cards = items.map((wk, i) => editorCard(`職歴 ${i + 1}`, [
      fieldHtml('会社名', `workExperience.${i}.companyName`, wk.companyName, { wide: true }),
      fieldHtml('部署・役職', `workExperience.${i}.departmentTitle`, wk.departmentTitle, { wide: true }),
      fieldHtml('職種', `workExperience.${i}.occupation`, wk.occupation),
      fieldHtml('雇用形態', `workExperience.${i}.employmentType`, wk.employmentType),
      fieldHtml('開始年', `workExperience.${i}.startYear`, wk.startYear),
      fieldHtml('開始月', `workExperience.${i}.startMonth`, wk.startMonth),
      fieldHtml('終了年', `workExperience.${i}.endYear`, wk.endYear),
      fieldHtml('終了月', `workExperience.${i}.endMonth`, wk.endMonth),
      fieldHtml('現在勤務中', `workExperience.${i}.currentlyWorking`, !!wk.currentlyWorking, { type: 'checkbox', wide: true }),
      fieldHtml('業務内容', `workExperience.${i}.responsibilities`, wk.responsibilities, { type: 'textarea', wide: true })
    ].join(''), reorderControls('workExperience', i, items.length), `data-reorder-key="workExperience" data-index="${i}"`)).join('');
    return `
      <div class="editor-help work-add-help">
        <div><strong>職歴の追加位置</strong><br>新しい経歴を追加するときの並び順を選択できます。</div>
        <label class="work-add-position"><span>追加位置</span><select data-store-setting="workAddPosition">
          <option value="prepend"${addPosition === 'prepend' ? ' selected' : ''}>先頭（職歴1に追加・デフォルト）</option>
          <option value="append"${addPosition === 'append' ? ' selected' : ''}>末尾</option>
        </select></label>
      </div>
      ${reorderHelp('職歴')}
      ${cards ? '<button type="button" class="add-row" data-add="workExperience">＋ 職歴を追加</button>' : ''}
      ${cards || '<div class="editor-empty">職歴はまだ登録されていません。</div>'}
      <button type="button" class="add-row" data-add="workExperience">＋ 職歴を追加</button>`;
  }

  function renderCertTab(profile) {
    const items = profile.certifications || [];
    const cards = items.map((cert, i) => editorCard(`資格 ${i + 1}`, [
      fieldHtml('資格・免許名', `certifications.${i}.name`, cert.name, { wide: true }),
      fieldHtml('取得年', `certifications.${i}.issueYear`, cert.issueYear),
      fieldHtml('取得月', `certifications.${i}.issueMonth`, cert.issueMonth)
    ].join(''), reorderControls('certifications', i, items.length), `data-reorder-key="certifications" data-index="${i}"`)).join('');
    return `${reorderHelp('資格')}${cards || '<div class="editor-empty">資格はまだ登録されていません。</div>'}<button type="button" class="add-row" data-add="certifications">＋ 資格を追加</button>`;
  }

  function renderTextTab(profile) {
    return `
      <div class="editor-help">サイトによって「自己PR」「企業向けコメント」「応募先へのメッセージ」など名称が異なるため、用途別に保存できます。</div>
      ${editorCard('職歴・スキル補足', fieldHtml('職歴備考', 'workNotes', profile.workNotes, { type: 'textarea', wide: true }))}
      ${editorCard('自己PR / 企業向けコメント', fieldHtml('自己PR', 'selfPR', profile.selfPR, { type: 'textarea', wide: true }))}
      ${editorCard('応募先へのメッセージ', fieldHtml('メッセージ', 'message', profile.message, { type: 'textarea', wide: true }))}
      ${editorCard('その他希望', fieldHtml('希望・補足', 'wishes', profile.wishes, { type: 'textarea', wide: true }))}`;
  }

  function renderLinksTab(profile) {
    const links = profile.links || {};
    const salary = profile.salary || {};
    const pref = profile.formPreferences || {};
    return `
      ${editorCard('URL・アカウント', [
        fieldHtml('GitHub', 'links.github', links.github, { type: 'url', wide: true }),
        fieldHtml('LinkedIn', 'links.linkedin', links.linkedin, { type: 'url', wide: true }),
        fieldHtml('ポートフォリオ', 'links.portfolio', links.portfolio, { type: 'url', wide: true }),
        fieldHtml('Webサイト', 'links.website', links.website, { type: 'url', wide: true })
      ].join(''))}
      ${editorCard('給与・勤務地', [
        fieldHtml('給与種別', 'salary.type', salary.type, { type: 'select', choices: ['', '時給', '日給', '月給', '年収'] }),
        fieldHtml('給与額', 'salary.amount', salary.amount),
        `<label class="editor-field wide"><span>勤務希望拠点</span><small>複数選択はカンマ区切り。チェックボックス／複数選択ではすべて選択し、ラジオボタンでは先頭の一致候補を選びます。</small><input data-path="formPreferences.preferredLocation" value="${escapeHtml(pref.preferredLocation || '')}"></label>`,
        `<label class="editor-field wide"><span>その他勤務可能拠点</span><small>複数ある場合はカンマ区切り</small><input data-array-csv-path="formPreferences.otherLocations" value="${escapeHtml((pref.otherLocations || []).join(', '))}"></label>`,
        fieldHtml('旧形式：給与種別', 'formPreferences.salaryType', pref.salaryType),
        fieldHtml('旧形式：給与額', 'formPreferences.salaryAmount', pref.salaryAmount),
        fieldHtml('希望記入欄', 'formPreferences.requestNotes', pref.requestNotes, { type: 'textarea', wide: true }),
        fieldHtml('追加URL', 'formPreferences.attachmentUrls', pref.attachmentUrls, { type: 'textarea', wide: true }),
        fieldHtml('過去の連絡有無', 'formPreferences.priorContact', pref.priorContact, { wide: true })
      ].join(''))}`;
  }

  function customValueType(value) {
    if (Array.isArray(value)) return 'multiple';
    if (typeof value === 'boolean') return 'boolean';
    return 'text';
  }

  function renderCustomTab(profile) {
    const items = profile.customAnswers || [];
    const cards = items.map((rule, i) => {
      const type = customValueType(rule.value);
      const displayValue = Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? '');
      return `<section class="editor-card custom-answer-card" data-custom-index="${i}" data-reorder-key="customAnswers" data-index="${i}">
        <div class="editor-card-head"><strong>独自回答 ${i + 1}</strong>${reorderControls('customAnswers', i, items.length)}</div>
        <div class="editor-grid">
          <label class="editor-field wide"><span>質問文の照合文字</span><small>例：希望勤務地|preferred work location</small><input data-custom-key="match" value="${escapeHtml(rule.match)}"></label>
          <label class="editor-field"><span>照合方法</span><select data-custom-key="mode"><option value="regex"${(rule.mode || 'regex') === 'regex' ? ' selected' : ''}>正規表現</option><option value="includes"${rule.mode === 'includes' ? ' selected' : ''}>部分一致</option><option value="exact"${rule.mode === 'exact' ? ' selected' : ''}>完全一致</option></select></label>
          <label class="editor-field"><span>回答形式</span><select data-custom-key="valueType"><option value="text"${type === 'text' ? ' selected' : ''}>文字・単一選択</option><option value="multiple"${type === 'multiple' ? ' selected' : ''}>複数選択</option><option value="boolean"${type === 'boolean' ? ' selected' : ''}>はい / いいえ</option></select></label>
          <label class="editor-field wide"><span>回答</span><small>複数選択はカンマ区切り。ラジオは先頭一致、チェックボックス等は複数一致を選択。はい/いいえは true / false</small><input data-custom-key="value" value="${escapeHtml(displayValue)}"></label>
        </div></section>`;
    }).join('');
    return `<div class="editor-help">企業固有の質問だけを追加します。文字入力・プルダウン・ラジオボタン・チェックボックス・スイッチ・複数選択に対応します。プライバシー同意・ファイル添付・送信は自動化対象外です。</div>${reorderHelp('企業独自回答')}${cards || '<div class="editor-empty">企業独自回答はまだ登録されていません。</div>'}<button type="button" class="add-row" data-add="customAnswers">＋ 独自回答を追加</button>`;
  }

  const EDITOR_TABS = [
    ['basic', '基本情報'], ['address', '住所'], ['education', '学歴'], ['work', '職歴'],
    ['cert', '資格'], ['text', '自己PR・文章'], ['links', 'リンク・希望'], ['custom', '企業独自']
  ];

  const EDITOR_WINDOW_DEFAULT = { width: 1040, height: 820 };

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function getEditorWindowPrefs() {
    try {
      const raw = parseStoredValue(GM_getValue(EDITOR_WINDOW_KEY, '')) || {};
      return {
        width: Number(raw.width) || EDITOR_WINDOW_DEFAULT.width,
        height: Number(raw.height) || EDITOR_WINDOW_DEFAULT.height
      };
    } catch {
      return { ...EDITOR_WINDOW_DEFAULT };
    }
  }

  function saveEditorWindowPrefs(width, height) {
    try {
      GM_setValue(EDITOR_WINDOW_KEY, JSON.stringify({
        width: Math.round(width),
        height: Math.round(height)
      }));
    } catch (e) {
      console.warn('[求人応募入力支援] 設定画面サイズを保存できませんでした:', e);
    }
  }

  function editorWindowLimits() {
    const margin = window.innerWidth <= 760 ? 6 : 12;
    const maxWidth = Math.max(280, window.innerWidth - margin * 2);
    const maxHeight = Math.max(320, window.innerHeight - margin * 2);
    return {
      margin,
      minWidth: Math.min(620, maxWidth),
      minHeight: Math.min(420, maxHeight),
      maxWidth,
      maxHeight
    };
  }

  function rectToGeometry(rect) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function applyDialogGeometry(dialog, geometry, { persist = false } = {}) {
    if (!dialog || !geometry) return;
    const limits = editorWindowLimits();
    const width = clampNumber(Number(geometry.width), limits.minWidth, limits.maxWidth);
    const height = clampNumber(Number(geometry.height), limits.minHeight, limits.maxHeight);
    const left = clampNumber(Number(geometry.left), limits.margin, Math.max(limits.margin, window.innerWidth - width - limits.margin));
    const top = clampNumber(Number(geometry.top), limits.margin, Math.max(limits.margin, window.innerHeight - height - limits.margin));
    Object.assign(dialog.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${Math.round(width)}px`,
      height: `${Math.round(height)}px`,
      transform: 'none'
    });
    if (persist) saveEditorWindowPrefs(width, height);
  }

  function initialEditorGeometry() {
    const limits = editorWindowLimits();
    const prefs = getEditorWindowPrefs();
    const width = clampNumber(prefs.width, limits.minWidth, limits.maxWidth);
    const height = clampNumber(prefs.height, limits.minHeight, limits.maxHeight);
    return {
      width,
      height,
      left: Math.max(limits.margin, (window.innerWidth - width) / 2),
      top: Math.max(limits.margin, (window.innerHeight - height) / 2)
    };
  }

  let editorPageScrollLock = null;

  function lockEditorBackgroundScroll() {
    if (editorPageScrollLock || !document.body) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
    const computedPaddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;

    editorPageScrollLock = {
      scrollX,
      scrollY,
      html: {
        overflow: html.style.overflow,
        overscrollBehavior: html.style.overscrollBehavior
      },
      body: {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        overscrollBehavior: body.style.overscrollBehavior,
        paddingRight: body.style.paddingRight
      }
    };

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    if (scrollbarWidth > 0) body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
  }

  function unlockEditorBackgroundScroll() {
    const state = editorPageScrollLock;
    if (!state || !document.body) return;
    const html = document.documentElement;
    const body = document.body;

    html.style.overflow = state.html.overflow;
    html.style.overscrollBehavior = state.html.overscrollBehavior;
    body.style.position = state.body.position;
    body.style.top = state.body.top;
    body.style.left = state.body.left;
    body.style.right = state.body.right;
    body.style.width = state.body.width;
    body.style.overflow = state.body.overflow;
    body.style.overscrollBehavior = state.body.overscrollBehavior;
    body.style.paddingRight = state.body.paddingRight;

    editorPageScrollLock = null;
    window.scrollTo(state.scrollX, state.scrollY);
  }

  function closeProfileEditor() {
    document.getElementById(MODAL_ID)?.remove();
    unlockEditorBackgroundScroll();
  }

  function openProfileEditor() {
    closeProfileEditor();
    lockEditorBackgroundScroll();
    let workingStore = structuredClone(getProfileStore());
    let currentTab = 'basic';
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="hrmos-af-backdrop"></div>
      <div class="hrmos-af-dialog" role="dialog" aria-modal="true" aria-label="プロフィール設定">
        <div class="hrmos-af-dialog-head">
          <div class="editor-title"><strong>プロフィール設定</strong><small>複数プロフィール対応・右下ドラッグでもサイズ調整できます</small></div>
          <div class="editor-window-controls" aria-label="ウインドウ操作">
            <button type="button" data-act="minimize" aria-label="最小化" title="最小化">−</button>
            <button type="button" data-act="maximize" aria-label="最大化" title="最大化">□</button>
            <button type="button" data-act="close" aria-label="閉じる" title="閉じる">×</button>
          </div>
        </div>
        <div class="profile-manager">
          <label><span>編集するプロフィール</span><select data-act="profile-select"></select></label>
          <label class="profile-name"><span>プロフィール名</span><input data-act="profile-name" maxlength="60"></label>
          <label class="input-mode-setting"><span>入力対象（全プロフィール共通）</span><select data-act="input-mode-setting"><option value="all">入力可能な項目</option><option value="required">必須項目のみ</option></select></label>
          <div class="profile-actions">
            <button type="button" data-act="new-profile">新規</button>
            <button type="button" data-act="duplicate-profile">複製</button>
            <button type="button" class="danger" data-act="delete-profile">削除</button>
          </div>
        </div>
        <div class="editor-tabs" role="tablist"></div>
        <div class="hrmos-af-dialog-body"><div class="editor-form"></div></div>
        <div class="hrmos-af-dialog-actions">
          <button type="button" data-act="reset-profile">このプロフィールを初期値に戻す</button>
          <span class="hrmos-af-editor-msg" aria-live="polite"></span>
          <button type="button" data-act="save" class="primary">すべて保存</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const select = modal.querySelector('[data-act="profile-select"]');
    const nameInput = modal.querySelector('[data-act="profile-name"]');
    const inputModeSelect = modal.querySelector('[data-act="input-mode-setting"]');
    const tabs = modal.querySelector('.editor-tabs');
    const formHost = modal.querySelector('.editor-form');
    const msg = modal.querySelector('.hrmos-af-editor-msg');
    const dialog = modal.querySelector('.hrmos-af-dialog');
    const minimizeButton = modal.querySelector('[data-act="minimize"]');
    const maximizeButton = modal.querySelector('[data-act="maximize"]');
    let editorWindowMode = 'normal';
    let modeBeforeMinimize = 'normal';
    let normalGeometry = initialEditorGeometry();
    let resizeSaveTimer = null;

    applyDialogGeometry(dialog, normalGeometry);

    const currentRecord = () => workingStore.profiles.find(p => p.id === workingStore.activeId) || workingStore.profiles[0];

    function readCustomRulesFromForm({ keepBlank = false } = {}) {
      const rules = [];
      for (const card of formHost.querySelectorAll('.custom-answer-card')) {
        const get = key => card.querySelector(`[data-custom-key="${key}"]`)?.value ?? '';
        const match = clean(get('match'));
        if (!match && !keepBlank) continue;
        const mode = get('mode') || 'regex';
        const valueType = get('valueType') || 'text';
        const raw = get('value');
        let value = raw;
        if (valueType === 'multiple') value = raw.split(/[,、\n]/).map(clean).filter(Boolean);
        else if (valueType === 'boolean') value = /^(true|1|yes|はい|有効)$/i.test(clean(raw));
        rules.push({ match, mode, value });
      }
      return rules;
    }

    function commitCurrentTab() {
      const record = currentRecord();
      if (!record) return;
      record.name = clean(nameInput.value) || record.name || 'プロフィール';
      for (const control of formHost.querySelectorAll('[data-path]')) {
        const value = control.type === 'checkbox' ? control.checked : control.value;
        deepSet(record.data, control.dataset.path, value);
      }
      for (const control of formHost.querySelectorAll('[data-array-csv-path]')) {
        deepSet(record.data, control.dataset.arrayCsvPath, control.value.split(/[,、\n]/).map(clean).filter(Boolean));
      }
      workingStore.settings = normalizeEditorSettings({ ...workingStore.settings, inputMode: inputModeSelect?.value || 'all' });
      for (const control of formHost.querySelectorAll('[data-store-setting]')) {
        if (!workingStore.settings || typeof workingStore.settings !== 'object') workingStore.settings = normalizeEditorSettings();
        workingStore.settings[control.dataset.storeSetting] = control.value;
        workingStore.settings = normalizeEditorSettings(workingStore.settings);
      }
      if (currentTab === 'custom') {
        record.data.customAnswers = readCustomRulesFromForm();
      }
    }

    function renderProfileSelector() {
      select.innerHTML = workingStore.profiles.map(p => `<option value="${escapeHtml(p.id)}"${p.id === workingStore.activeId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
      nameInput.value = currentRecord()?.name || '';
      if (inputModeSelect) inputModeSelect.value = normalizeEditorSettings(workingStore.settings).inputMode;
      modal.querySelector('[data-act="delete-profile"]').disabled = workingStore.profiles.length <= 1;
    }

    function renderTabs() {
      tabs.innerHTML = EDITOR_TABS.map(([id, label]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === currentTab}" class="${id === currentTab ? 'active' : ''}">${escapeHtml(label)}</button>`).join('');
    }

    function renderForm() {
      const profile = currentRecord()?.data || emptyProfile();
      const renders = {
        basic: renderBasicTab, address: renderAddressTab, education: renderEducationTab,
        work: renderWorkTab, cert: renderCertTab, text: renderTextTab,
        links: renderLinksTab, custom: renderCustomTab
      };
      const renderer = renders[currentTab] || renderBasicTab;
      formHost.innerHTML = currentTab === 'work' ? renderer(profile, workingStore) : renderer(profile);
    }

    function renderAll() {
      renderProfileSelector();
      renderTabs();
      renderForm();
    }

    function updateWindowButtons() {
      const minimized = editorWindowMode === 'minimized';
      const maximized = editorWindowMode === 'maximized';
      minimizeButton.textContent = minimized ? '▣' : '−';
      minimizeButton.title = minimized ? '元に戻す' : '最小化';
      minimizeButton.setAttribute('aria-label', minimized ? '元に戻す' : '最小化');
      maximizeButton.textContent = maximized ? '❐' : '□';
      maximizeButton.title = maximized ? '元のサイズに戻す' : '最大化';
      maximizeButton.setAttribute('aria-label', maximized ? '元のサイズに戻す' : '最大化');
    }

    function captureNormalGeometry({ persist = true } = {}) {
      if (editorWindowMode !== 'normal') return;
      normalGeometry = rectToGeometry(dialog.getBoundingClientRect());
      if (persist) saveEditorWindowPrefs(normalGeometry.width, normalGeometry.height);
    }

    function restoreNormalWindow() {
      editorWindowMode = 'normal';
      modal.classList.remove('is-minimized');
      dialog.classList.remove('is-minimized', 'is-maximized');
      dialog.setAttribute('aria-modal', 'true');
      applyDialogGeometry(dialog, normalGeometry || initialEditorGeometry());
      lockEditorBackgroundScroll();
      updateWindowButtons();
    }

    function toggleMinimize() {
      if (editorWindowMode === 'minimized') {
        if (modeBeforeMinimize === 'maximized') {
          editorWindowMode = 'maximized';
          modal.classList.remove('is-minimized');
          dialog.classList.remove('is-minimized');
          dialog.classList.add('is-maximized');
          dialog.setAttribute('aria-modal', 'true');
          lockEditorBackgroundScroll();
        } else {
          restoreNormalWindow();
          return;
        }
      } else {
        if (editorWindowMode === 'normal') captureNormalGeometry();
        modeBeforeMinimize = editorWindowMode;
        editorWindowMode = 'minimized';
        modal.classList.add('is-minimized');
        dialog.classList.remove('is-maximized');
        dialog.classList.add('is-minimized');
        dialog.setAttribute('aria-modal', 'false');
        unlockEditorBackgroundScroll();
      }
      updateWindowButtons();
    }

    function toggleMaximize() {
      if (editorWindowMode === 'minimized') {
        modeBeforeMinimize = 'maximized';
        toggleMinimize();
        return;
      }
      if (editorWindowMode === 'maximized') {
        restoreNormalWindow();
        return;
      }
      captureNormalGeometry();
      editorWindowMode = 'maximized';
      dialog.classList.add('is-maximized');
      const limits = editorWindowLimits();
      Object.assign(dialog.style, {
        left: `${limits.margin}px`,
        top: `${limits.margin}px`,
        right: 'auto',
        bottom: 'auto',
        width: `${limits.maxWidth}px`,
        height: `${limits.maxHeight}px`,
        transform: 'none'
      });
      updateWindowButtons();
    }

    modal.querySelector('[data-act="close"]').addEventListener('click', closeProfileEditor);
    modal.querySelector('.hrmos-af-backdrop').addEventListener('click', closeProfileEditor);
    minimizeButton.addEventListener('click', toggleMinimize);
    maximizeButton.addEventListener('click', toggleMaximize);

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (editorWindowMode !== 'normal') return;
      cancelAnimationFrame(resizeObserver._raf || 0);
      resizeObserver._raf = requestAnimationFrame(() => {
        const rect = dialog.getBoundingClientRect();
        applyDialogGeometry(dialog, rectToGeometry(rect));
        normalGeometry = rectToGeometry(dialog.getBoundingClientRect());
        clearTimeout(resizeSaveTimer);
        resizeSaveTimer = setTimeout(() => saveEditorWindowPrefs(normalGeometry.width, normalGeometry.height), 180);
      });
    }) : null;
    resizeObserver?.observe(dialog);

    const onViewportResize = () => {
      if (editorWindowMode === 'maximized') {
        const limits = editorWindowLimits();
        Object.assign(dialog.style, {
          left: `${limits.margin}px`, top: `${limits.margin}px`,
          width: `${limits.maxWidth}px`, height: `${limits.maxHeight}px`
        });
      } else if (editorWindowMode === 'normal') {
        applyDialogGeometry(dialog, rectToGeometry(dialog.getBoundingClientRect()));
        normalGeometry = rectToGeometry(dialog.getBoundingClientRect());
      }
    };
    window.addEventListener('resize', onViewportResize, { passive: true });
    updateWindowButtons();

    select.addEventListener('change', () => {
      commitCurrentTab();
      workingStore.activeId = select.value;
      renderAll();
    });

    function commitListForReorder(key) {
      const record = currentRecord();
      if (!record) return;
      if (key === 'customAnswers') {
        record.data.customAnswers = readCustomRulesFromForm({ keepBlank: true });
      } else {
        commitCurrentTab();
      }
    }

    function moveListItem(key, fromIndex, toIndex) {
      const record = currentRecord();
      const list = record?.data?.[key];
      if (!Array.isArray(list) || !list.length) return false;
      const from = clampNumber(Number(fromIndex), 0, list.length - 1);
      const to = clampNumber(Number(toIndex), 0, list.length - 1);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      return true;
    }

    function focusReorderHandle(index) {
      requestAnimationFrame(() => {
        const cards = [...formHost.querySelectorAll('[data-reorder-key]')];
        const card = cards[index];
        card?.querySelector('[data-reorder-handle]')?.focus();
      });
    }

    tabs.addEventListener('click', e => {
      const button = e.target.closest('[data-tab]');
      if (!button) return;
      commitCurrentTab();
      currentTab = button.dataset.tab;
      renderTabs();
      renderForm();
    });

    formHost.addEventListener('click', e => {
      const add = e.target.closest('[data-add]');
      const remove = e.target.closest('[data-remove-array]');
      const move = e.target.closest('[data-reorder-move]');
      if (!add && !remove && !move) return;

      if (move) {
        const card = move.closest('[data-reorder-key]');
        if (!card) return;
        const key = card.dataset.reorderKey;
        const from = Number(card.dataset.index);
        const delta = Number(move.dataset.reorderMove);
        commitListForReorder(key);
        const record = currentRecord();
        const list = record?.data?.[key];
        const to = Array.isArray(list) ? clampNumber(from + delta, 0, list.length - 1) : from;
        if (moveListItem(key, from, to)) {
          renderForm();
          focusReorderHandle(to);
        }
        return;
      }

      commitCurrentTab();
      const record = currentRecord();
      if (add) {
        const key = add.dataset.add;
        const templates = {
          education: { schoolName: '', fieldOfStudy: '', level: '', startYear: '', startMonth: '', endYear: '', endMonth: '' },
          workExperience: { companyName: '', departmentTitle: '', occupation: '', employmentType: '', startYear: '', startMonth: '', endYear: '', endMonth: '', currentlyWorking: false, responsibilities: '' },
          certifications: { issueYear: '', issueMonth: '', name: '' },
          customAnswers: { match: '', mode: 'regex', value: '' }
        };
        if (!Array.isArray(record.data[key])) record.data[key] = [];
        const item = structuredClone(templates[key] || {});
        if (key === 'workExperience' && normalizeEditorSettings(workingStore.settings).workAddPosition === 'prepend') {
          record.data[key].unshift(item);
        } else {
          record.data[key].push(item);
        }
      } else {
        const key = remove.dataset.removeArray;
        const index = Number(remove.dataset.index);
        if (Array.isArray(record.data[key]) && Number.isInteger(index)) record.data[key].splice(index, 1);
      }
      renderForm();
    });

    formHost.addEventListener('keydown', e => {
      const handle = e.target.closest?.('[data-reorder-handle]');
      if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const card = handle.closest('[data-reorder-key]');
      if (!card) return;
      e.preventDefault();
      const key = card.dataset.reorderKey;
      const from = Number(card.dataset.index);
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      commitListForReorder(key);
      const record = currentRecord();
      const list = record?.data?.[key];
      const to = Array.isArray(list) ? clampNumber(from + delta, 0, list.length - 1) : from;
      if (moveListItem(key, from, to)) {
        renderForm();
        focusReorderHandle(to);
      }
    });

    let reorderDrag = null;
    const editorBody = modal.querySelector('.hrmos-af-dialog-body');

    function finishReorderDrag({ cancel = false } = {}) {
      if (!reorderDrag) return;
      const { handle, pointerId, card, key, originalArray } = reorderDrag;
      try { handle.releasePointerCapture?.(pointerId); } catch {}
      formHost.classList.remove('is-reordering');
      card.classList.remove('is-dragging');

      if (cancel) {
        const record = currentRecord();
        if (record?.data) record.data[key] = originalArray;
        reorderDrag = null;
        renderForm();
        return;
      }

      const record = currentRecord();
      if (key === 'customAnswers') {
        record.data.customAnswers = readCustomRulesFromForm({ keepBlank: true });
      } else {
        commitCurrentTab();
        const current = record?.data?.[key];
        if (Array.isArray(current)) {
          const orderedOriginalIndexes = [...formHost.querySelectorAll(`[data-reorder-key="${key}"]`)]
            .map(node => Number(node.dataset.index))
            .filter(Number.isInteger);
          if (orderedOriginalIndexes.length === current.length) {
            record.data[key] = orderedOriginalIndexes.map(i => current[i]);
          }
        }
      }

      const finalIndex = [...formHost.querySelectorAll(`[data-reorder-key="${key}"]`)].indexOf(card);
      reorderDrag = null;
      renderForm();
      focusReorderHandle(Math.max(0, finalIndex));
    }

    formHost.addEventListener('pointerdown', e => {
      const handle = e.target.closest?.('[data-reorder-handle]');
      if (!handle || e.button !== 0 || reorderDrag) return;
      const card = handle.closest('[data-reorder-key]');
      if (!card) return;
      const key = card.dataset.reorderKey;
      commitListForReorder(key);
      const record = currentRecord();
      const list = record?.data?.[key];
      if (!Array.isArray(list) || list.length < 2) return;
      e.preventDefault();
      reorderDrag = {
        pointerId: e.pointerId, handle, card, key,
        originalArray: structuredClone(list)
      };
      handle.setPointerCapture?.(e.pointerId);
      card.classList.add('is-dragging');
      formHost.classList.add('is-reordering');
    });

    formHost.addEventListener('pointermove', e => {
      if (!reorderDrag || e.pointerId !== reorderDrag.pointerId) return;
      e.preventDefault();
      const { card, key } = reorderDrag;
      const bodyRect = editorBody?.getBoundingClientRect();
      if (bodyRect && editorBody) {
        const edge = 54;
        if (e.clientY < bodyRect.top + edge) editorBody.scrollBy({ top: -22, behavior: 'auto' });
        else if (e.clientY > bodyRect.bottom - edge) editorBody.scrollBy({ top: 22, behavior: 'auto' });
      }

      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-reorder-key]');
      if (!hit || hit === card || hit.dataset.reorderKey !== key || !formHost.contains(hit)) return;
      const rect = hit.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        hit.before(card);
      } else {
        hit.after(card);
      }
    });

    formHost.addEventListener('pointerup', e => {
      if (reorderDrag && e.pointerId === reorderDrag.pointerId) finishReorderDrag();
    });
    formHost.addEventListener('pointercancel', e => {
      if (reorderDrag && e.pointerId === reorderDrag.pointerId) finishReorderDrag({ cancel: true });
    });

    modal.querySelector('[data-act="new-profile"]').addEventListener('click', () => {
      commitCurrentTab();
      const id = newProfileId();
      workingStore.profiles.push({ id, name: `新規プロフィール ${workingStore.profiles.length + 1}`, data: emptyProfile() });
      workingStore.activeId = id;
      currentTab = 'basic';
      renderAll();
    });

    modal.querySelector('[data-act="duplicate-profile"]').addEventListener('click', () => {
      commitCurrentTab();
      const source = currentRecord();
      const id = newProfileId();
      workingStore.profiles.push({ id, name: `${source.name} のコピー`, data: structuredClone(source.data) });
      workingStore.activeId = id;
      renderAll();
    });

    modal.querySelector('[data-act="delete-profile"]').addEventListener('click', () => {
      if (workingStore.profiles.length <= 1) return;
      const target = currentRecord();
      if (!confirm(`「${target.name}」を削除しますか？`)) return;
      workingStore.profiles = workingStore.profiles.filter(p => p.id !== target.id);
      workingStore.activeId = workingStore.profiles[0].id;
      currentTab = 'basic';
      renderAll();
    });

    modal.querySelector('[data-act="reset-profile"]').addEventListener('click', () => {
      const target = currentRecord();
      if (!confirm(`「${target.name}」の内容を初期プロフィールに戻しますか？`)) return;
      target.data = structuredClone(DEFAULT_PROFILE);
      currentTab = 'basic';
      renderAll();
      msg.textContent = '初期値へ戻しました。保存するまで確定されません。';
      msg.className = 'hrmos-af-editor-msg';
    });

    modal.querySelector('[data-act="save"]').addEventListener('click', () => {
      try {
        commitCurrentTab();
        workingStore = saveProfileStore(workingStore);
        msg.textContent = `「${getActiveProfileName()}」を保存しました。`;
        msg.className = 'hrmos-af-editor-msg ok';
        syncPanelProfileSelect();
        syncPanelInputMode();
        updateStatus(null);
        renderProfileSelector();
      } catch (e) {
        msg.textContent = `保存できませんでした: ${e.message}`;
        msg.className = 'hrmos-af-editor-msg error';
      }
    });

    const onEditorKeyDown = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeProfileEditor();
        document.removeEventListener('keydown', onEditorKeyDown, true);
      }
    };
    document.addEventListener('keydown', onEditorKeyDown, true);

    const editorObserver = new MutationObserver(() => {
      if (!document.getElementById(MODAL_ID)) {
        document.removeEventListener('keydown', onEditorKeyDown, true);
        window.removeEventListener('resize', onViewportResize);
        resizeObserver?.disconnect();
        clearTimeout(resizeSaveTimer);
        editorObserver.disconnect();
        unlockEditorBackgroundScroll();
      }
    });
    editorObserver.observe(document.documentElement, { childList: true, subtree: true });

    renderAll();
  }

  function syncPanelProfileSelect() {
    const select = document.querySelector(`#${PANEL_ID} [data-act="active-profile"]`);
    if (!select) return;
    const store = getProfileStore();
    select.innerHTML = store.profiles.map(p => `<option value="${escapeHtml(p.id)}"${p.id === store.activeId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  }

  function syncPanelInputMode() {
    const select = document.querySelector(`#${PANEL_ID} [data-act="input-mode"]`);
    if (select) select.value = getInputMode();
  }

  const PANEL_WINDOW_DEFAULT = { width: 350, left: null, top: null, minimized: false };

  function getPanelWindowPrefs() {
    try {
      const raw = parseStoredValue(GM_getValue(PANEL_WINDOW_KEY, '')) || {};
      return {
        width: Number(raw.width) || PANEL_WINDOW_DEFAULT.width,
        left: Number.isFinite(Number(raw.left)) ? Number(raw.left) : null,
        top: Number.isFinite(Number(raw.top)) ? Number(raw.top) : null,
        minimized: raw.minimized === true
      };
    } catch {
      return { ...PANEL_WINDOW_DEFAULT };
    }
  }

  function savePanelWindowPrefs(panel, overrides = {}) {
    if (!panel) return;
    const current = getPanelWindowPrefs();
    const rect = panel.getBoundingClientRect();
    const minimized = overrides.minimized ?? panel.classList.contains('is-minimized');
    const width = minimized
      ? (Number(overrides.width) || Number(panel.dataset.normalWidth) || current.width || PANEL_WINDOW_DEFAULT.width)
      : (Number(overrides.width) || rect.width || current.width || PANEL_WINDOW_DEFAULT.width);
    try {
      GM_setValue(PANEL_WINDOW_KEY, JSON.stringify({
        width: Math.round(width),
        left: Math.round(Number(overrides.left) || rect.left),
        top: Math.round(Number(overrides.top) || rect.top),
        minimized
      }));
    } catch (e) {
      console.warn('[求人応募入力支援] パネル位置・サイズを保存できませんでした:', e);
    }
  }

  function panelWindowLimits(panel, width = null, height = null) {
    const margin = window.innerWidth <= 760 ? 6 : 10;
    const rect = panel?.getBoundingClientRect?.() || { width: 350, height: 180 };
    const actualWidth = width ?? rect.width;
    const actualHeight = height ?? rect.height;
    return {
      margin,
      minWidth: Math.min(310, Math.max(220, window.innerWidth - margin * 2)),
      maxWidth: Math.max(220, Math.min(720, window.innerWidth - margin * 2)),
      maxLeft: Math.max(margin, window.innerWidth - actualWidth - margin),
      maxTop: Math.max(margin, window.innerHeight - actualHeight - margin)
    };
  }

  function clampPanelPosition(panel, { persist = false } = {}) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const limits = panelWindowLimits(panel, rect.width, rect.height);
    const left = clampNumber(rect.left, limits.margin, limits.maxLeft);
    const top = clampNumber(rect.top, limits.margin, limits.maxTop);
    Object.assign(panel.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: 'auto',
      bottom: 'auto'
    });
    if (persist) savePanelWindowPrefs(panel, { left, top });
  }

  function applyPanelWindowPrefs(panel) {
    const prefs = getPanelWindowPrefs();
    const limits = panelWindowLimits(panel);
    const width = clampNumber(prefs.width, limits.minWidth, limits.maxWidth);
    panel.dataset.normalWidth = String(Math.round(width));
    panel.style.width = `${Math.round(width)}px`;

    const initialRect = panel.getBoundingClientRect();
    const left = prefs.left == null
      ? Math.max(limits.margin, window.innerWidth - initialRect.width - 18)
      : prefs.left;
    const top = prefs.top == null
      ? Math.max(limits.margin, window.innerHeight - initialRect.height - 18)
      : prefs.top;
    Object.assign(panel.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: 'auto',
      bottom: 'auto'
    });

    if (prefs.minimized) {
      panel.classList.add('is-minimized');
      panel.querySelector('[data-act="panel-minimize"]')?.setAttribute('aria-label', 'パネルを復元');
      const minBtn = panel.querySelector('[data-act="panel-minimize"]');
      if (minBtn) {
        minBtn.textContent = '▣';
        minBtn.title = '復元';
      }
    }
    requestAnimationFrame(() => clampPanelPosition(panel));
  }

  function setPanelMinimized(panel, minimized) {
    if (!panel) return;
    if (minimized) {
      const rect = panel.getBoundingClientRect();
      panel.dataset.normalWidth = String(Math.round(rect.width));
      panel.classList.add('is-minimized');
      const btn = panel.querySelector('[data-act="panel-minimize"]');
      if (btn) {
        btn.textContent = '▣';
        btn.title = '復元';
        btn.setAttribute('aria-label', 'パネルを復元');
      }
    } else {
      panel.classList.remove('is-minimized');
      const limits = panelWindowLimits(panel);
      const width = clampNumber(Number(panel.dataset.normalWidth) || getPanelWindowPrefs().width, limits.minWidth, limits.maxWidth);
      panel.style.width = `${Math.round(width)}px`;
      const btn = panel.querySelector('[data-act="panel-minimize"]');
      if (btn) {
        btn.textContent = '−';
        btn.title = '最小化';
        btn.setAttribute('aria-label', 'パネルを最小化');
      }
    }
    requestAnimationFrame(() => {
      clampPanelPosition(panel);
      savePanelWindowPrefs(panel, { minimized });
    });
  }


  function installPanelWindowBehavior(panel) {
    const dragHandle = panel.querySelector('[data-panel-drag]');
    let dragState = null;

    dragHandle?.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('button,select,input,textarea,a')) return;
      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      dragHandle.setPointerCapture?.(e.pointerId);
      panel.classList.add('is-dragging');
      e.preventDefault();
    });

    dragHandle?.addEventListener('pointermove', e => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      const limits = panelWindowLimits(panel, dragState.width, dragState.height);
      const left = clampNumber(dragState.left + e.clientX - dragState.startX, limits.margin, limits.maxLeft);
      const top = clampNumber(dragState.top + e.clientY - dragState.startY, limits.margin, limits.maxTop);
      Object.assign(panel.style, {
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        right: 'auto',
        bottom: 'auto'
      });
    });

    const finishDrag = e => {
      if (!dragState || (e?.pointerId !== undefined && e.pointerId !== dragState.pointerId)) return;
      try { dragHandle.releasePointerCapture?.(dragState.pointerId); } catch {}
      dragState = null;
      panel.classList.remove('is-dragging');
      clampPanelPosition(panel, { persist: true });
    };
    dragHandle?.addEventListener('pointerup', finishDrag);
    dragHandle?.addEventListener('pointercancel', finishDrag);

    panel.querySelector('[data-act="panel-minimize"]')?.addEventListener('click', () => {
      setPanelMinimized(panel, !panel.classList.contains('is-minimized'));
    });

    let resizeSaveTimer = 0;
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (panel.classList.contains('is-minimized') || panel.classList.contains('is-dragging')) return;
      const rect = panel.getBoundingClientRect();
      panel.dataset.normalWidth = String(Math.round(rect.width));
      clearTimeout(resizeSaveTimer);
      resizeSaveTimer = setTimeout(() => {
        clampPanelPosition(panel);
        savePanelWindowPrefs(panel, { width: rect.width });
      }, 180);
    }) : null;
    resizeObserver?.observe(panel);

    const onViewportResize = () => {
      if (!panel.isConnected) {
        window.removeEventListener('resize', onViewportResize);
        resizeObserver?.disconnect();
        return;
      }
      if (!panel.classList.contains('is-minimized')) {
        const limits = panelWindowLimits(panel);
        const width = clampNumber(panel.getBoundingClientRect().width, limits.minWidth, limits.maxWidth);
        panel.style.width = `${Math.round(width)}px`;
        panel.dataset.normalWidth = String(Math.round(width));
      }
      requestAnimationFrame(() => clampPanelPosition(panel));
    };
    window.addEventListener('resize', onViewportResize);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="hrmos-af-title" data-panel-drag>
        <div class="panel-title-text"><strong>求人応募 入力支援</strong><small>${SITE.name}</small></div>
        <div class="panel-window-controls">
          <button type="button" data-act="panel-minimize" title="最小化" aria-label="パネルを最小化">−</button>
        </div>
      </div>
      <div class="panel-content">
        <label class="panel-profile"><span>使用プロフィール</span><select data-act="active-profile"></select></label>
        <label class="panel-profile panel-input-mode"><span>入力対象</span><select data-act="input-mode"><option value="all">入力可能な項目</option><option value="required">必須項目のみ</option></select></label>
        <div class="hrmos-af-buttons">
          <button type="button" data-act="fill" class="primary">入力</button>
          <button type="button" data-act="profile">プロフィール設定</button>
          <button type="button" data-act="scan">項目確認</button>
        </div>
        <div class="hrmos-af-status"></div>
        <div class="hrmos-af-note">添付・同意・CAPTCHA・送信は手動です。</div>
      </div>`;
    document.body.appendChild(panel);
    syncPanelProfileSelect();
    syncPanelInputMode();
    updateStatus(null);
    installPanelWindowBehavior(panel);
    applyPanelWindowPrefs(panel);
    panel.querySelector('[data-act="active-profile"]').addEventListener('change', e => setActiveProfile(e.currentTarget.value));
    panel.querySelector('[data-act="input-mode"]').addEventListener('change', e => setInputMode(e.currentTarget.value));
    panel.querySelector('[data-act="fill"]').addEventListener('click', async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '入力中…';
      try { await autofill(); }
      catch (err) {
        console.error('[求人応募入力支援] 入力処理エラー:', err);
        panel.querySelector('.hrmos-af-status').textContent = `入力処理でエラーが発生しました: ${err.message}`;
      } finally {
        btn.disabled = false;
        btn.textContent = '入力';
      }
    });
    panel.querySelector('[data-act="profile"]').addEventListener('click', openProfileEditor);
    panel.querySelector('[data-act="scan"]').addEventListener('click', scanForm);
  }

  function installStyles() {
    GM_addStyle(`
      #${PANEL_ID}{position:fixed;right:18px;bottom:18px;z-index:2147483646;width:350px;min-width:310px;max-width:min(720px,calc(100vw - 20px));max-height:calc(100vh - 20px);box-sizing:border-box;background:#fff;border:1px solid #d8dee8;border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.18);padding:10px 12px 12px;color:#202631;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","Yu Gothic UI",sans-serif;resize:horizontal;overflow:auto;overscroll-behavior:contain}
      #${PANEL_ID} .hrmos-af-title{font-size:15px;font-weight:700;margin-bottom:9px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:move;user-select:none;touch-action:none}#${PANEL_ID}.is-dragging .hrmos-af-title{cursor:grabbing}#${PANEL_ID} .panel-title-text{display:flex;align-items:baseline;gap:8px;min-width:0}#${PANEL_ID} .panel-title-text strong{white-space:nowrap}#${PANEL_ID} .hrmos-af-title small{font-weight:500;color:#687382;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #${PANEL_ID} .panel-window-controls{display:flex;align-items:center;gap:4px;flex:0 0 auto}#${PANEL_ID} .panel-window-controls button{min-width:30px;height:27px;padding:2px 6px;font-size:11px;line-height:1}#${PANEL_ID} .panel-window-controls [data-act="panel-minimize"]{font-size:16px}
      #${PANEL_ID}.is-minimized{width:min(245px,calc(100vw - 12px))!important;min-width:0;max-width:calc(100vw - 12px);height:auto!important;max-height:none;padding:8px 9px;resize:none;overflow:hidden}#${PANEL_ID}.is-minimized .panel-content{display:none}#${PANEL_ID}.is-minimized .hrmos-af-title{margin-bottom:0}#${PANEL_ID}.is-minimized .panel-title-text small{display:none}
      #${PANEL_ID} .panel-profile{display:grid;grid-template-columns:90px minmax(0,1fr);align-items:center;gap:8px;margin-bottom:9px}#${PANEL_ID} .panel-profile span{font-size:12px;color:#596575}#${PANEL_ID} .panel-profile select{min-width:0;width:100%;padding:6px 7px;border:1px solid #c8d0dc;border-radius:7px;background:#fff;color:#1f2937}
      #${PANEL_ID} .hrmos-af-buttons{display:flex;gap:7px;flex-wrap:wrap}
      #${PANEL_ID} button,#${MODAL_ID} button{border:1px solid #b8c1ce;background:#fff;border-radius:7px;padding:7px 10px;cursor:pointer;color:#1f2937;font:inherit}#${PANEL_ID} button:hover,#${MODAL_ID} button:hover{background:#f4f6f8}
      #${PANEL_ID} button.primary,#${MODAL_ID} button.primary{background:#1769e0;color:#fff;border-color:#1769e0;font-weight:700}#${PANEL_ID} button:disabled,#${MODAL_ID} button:disabled{opacity:.5;cursor:not-allowed}
      #${PANEL_ID} .hrmos-af-status{margin-top:9px;padding-top:8px;border-top:1px solid #e7ebf0}#${PANEL_ID} .hrmos-af-note{margin-top:6px;color:#606b78;font-size:11.5px}
      .${HIGHLIGHT_CLASS}{outline:2px solid #e1a400!important;outline-offset:2px!important}
      #${MODAL_ID}{position:fixed;inset:0;z-index:2147483647;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Yu Gothic UI",sans-serif;color:#202631;overscroll-behavior:none}
      #${MODAL_ID} .hrmos-af-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.48)}
      #${MODAL_ID} .hrmos-af-dialog{position:absolute;background:#f8fafc;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;overscroll-behavior:none;resize:both;min-width:min(620px,calc(100vw - 24px));min-height:min(420px,calc(100vh - 24px));max-width:calc(100vw - 12px);max-height:calc(100vh - 12px)}
      #${MODAL_ID} .hrmos-af-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px 12px 18px;background:#fff;border-bottom:1px solid #e3e8ef;font-size:16px;flex:0 0 auto}#${MODAL_ID} .hrmos-af-dialog-head .editor-title{display:flex;flex-direction:column;gap:2px;min-width:0}#${MODAL_ID} .hrmos-af-dialog-head small{font-size:11.5px;font-weight:400;color:#687382;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${MODAL_ID} .editor-window-controls{display:flex;align-items:center;gap:5px;flex:0 0 auto}#${MODAL_ID} .editor-window-controls button{min-width:34px;height:32px;padding:3px 8px;display:grid;place-items:center;font-size:15px;line-height:1}
      #${MODAL_ID}.is-minimized{pointer-events:none}#${MODAL_ID}.is-minimized .hrmos-af-backdrop{display:none}#${MODAL_ID}.is-minimized .hrmos-af-dialog{pointer-events:auto;left:auto!important;top:auto!important;right:16px!important;bottom:16px!important;width:min(430px,calc(100vw - 24px))!important;height:auto!important;min-width:0;min-height:0;max-width:calc(100vw - 24px);max-height:none;resize:none;box-shadow:0 10px 34px rgba(0,0,0,.28)}#${MODAL_ID}.is-minimized .profile-manager,#${MODAL_ID}.is-minimized .editor-tabs,#${MODAL_ID}.is-minimized .hrmos-af-dialog-body,#${MODAL_ID}.is-minimized .hrmos-af-dialog-actions{display:none}#${MODAL_ID}.is-minimized .hrmos-af-dialog-head{border-bottom:0;padding:10px 10px 10px 14px}#${MODAL_ID}.is-minimized .hrmos-af-dialog-head small{display:none}#${MODAL_ID}.is-minimized [data-act="maximize"]{display:none}
      #${MODAL_ID} .hrmos-af-dialog.is-maximized{resize:none;border-radius:10px}
      #${MODAL_ID} .profile-manager{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) minmax(160px,.8fr) auto;gap:10px;align-items:end;padding:12px 18px;background:#fff;border-bottom:1px solid #e3e8ef}#${MODAL_ID} .profile-manager label{display:grid;gap:4px}#${MODAL_ID} .profile-manager label>span{font-size:11.5px;color:#5e6977;font-weight:600}#${MODAL_ID} .profile-manager input,#${MODAL_ID} .profile-manager select{box-sizing:border-box;width:100%;border:1px solid #c8d0dc;border-radius:7px;padding:8px;background:#fff;color:#202631;font:inherit}#${MODAL_ID} .profile-actions{display:flex;gap:6px}
      #${MODAL_ID} .editor-tabs{display:flex;gap:5px;overflow-x:auto;padding:9px 18px;background:#fff;border-bottom:1px solid #e3e8ef;overscroll-behavior-x:contain}#${MODAL_ID} .editor-tabs button{white-space:nowrap;border-color:transparent;background:transparent;padding:7px 9px}#${MODAL_ID} .editor-tabs button.active{background:#eaf2ff;border-color:#a9c7f5;color:#0f5fca;font-weight:700}
      #${MODAL_ID} .hrmos-af-dialog-body{flex:1;min-height:0;overflow:auto;padding:16px 18px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}#${MODAL_ID} .editor-form{max-width:900px;margin:0 auto;display:grid;gap:12px}
      #${MODAL_ID} .editor-help{padding:9px 11px;border:1px solid #cddcf4;background:#f4f8ff;border-radius:8px;color:#42536a}#${MODAL_ID} .work-add-help{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}#${MODAL_ID} .work-add-position{display:flex;align-items:center;gap:8px;font-weight:600}#${MODAL_ID} .work-add-position select{min-width:250px;max-width:100%;border:1px solid #b9c9df;border-radius:7px;padding:7px 9px;background:#fff;color:#202631;font:inherit}#${MODAL_ID} .editor-empty{padding:24px;text-align:center;color:#6b7685;border:1px dashed #c8d0dc;border-radius:9px;background:#fff}
      #${MODAL_ID} .editor-card{background:#fff;border:1px solid #dfe5ec;border-radius:10px;padding:13px}#${MODAL_ID} .editor-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px;font-size:14px}#${MODAL_ID} .editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}
      #${MODAL_ID} .reorder-help{margin-bottom:10px}#${MODAL_ID} .reorder-controls{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap}#${MODAL_ID} .reorder-controls button{min-width:34px;padding:5px 8px}#${MODAL_ID} .reorder-handle{cursor:grab;touch-action:none;font-weight:800;letter-spacing:-2px;line-height:1}#${MODAL_ID} .reorder-handle:active,#${MODAL_ID} .editor-card.is-dragging .reorder-handle{cursor:grabbing}#${MODAL_ID} .editor-card[data-reorder-key]{transition:border-color .12s ease,box-shadow .12s ease,opacity .12s ease}#${MODAL_ID} .editor-card.is-dragging{opacity:.72;border-color:#77a9ea;box-shadow:0 7px 20px rgba(31,92,166,.18)}#${MODAL_ID} .editor-form.is-reordering{user-select:none}#${MODAL_ID} .editor-form.is-reordering .editor-card[data-reorder-key]{cursor:default}
      #${MODAL_ID} .editor-field{display:grid;gap:4px;min-width:0}#${MODAL_ID} .editor-field.wide,#${MODAL_ID} .editor-check.wide{grid-column:1/-1}#${MODAL_ID} .editor-field>span{font-weight:600;color:#344150}#${MODAL_ID} .editor-field small,#${MODAL_ID} .editor-check small{font-weight:400;color:#788391;font-size:11px}#${MODAL_ID} .editor-field input,#${MODAL_ID} .editor-field select,#${MODAL_ID} .editor-field textarea{box-sizing:border-box;width:100%;border:1px solid #c8d0dc;border-radius:7px;padding:8px 9px;background:#fff;color:#202631;font:inherit}#${MODAL_ID} .editor-field textarea{min-height:105px;resize:vertical;line-height:1.5}#${MODAL_ID} .editor-check{display:flex;align-items:center;gap:7px;padding-top:20px}#${MODAL_ID} .editor-check input{width:18px;height:18px}
      #${MODAL_ID} .add-row{justify-self:start;border-style:dashed;background:#fff;padding:9px 14px}#${MODAL_ID} button.danger{color:#b42318;border-color:#e5b8b2}#${MODAL_ID} button.danger:hover{background:#fff3f2}#${MODAL_ID} button.subtle{padding:5px 8px;font-size:11.5px}
      #${MODAL_ID} .hrmos-af-dialog-actions{display:flex;align-items:center;gap:8px;padding:11px 18px;background:#fff;border-top:1px solid #e3e8ef}#${MODAL_ID} .hrmos-af-dialog-actions .hrmos-af-editor-msg{flex:1;min-width:0;color:#5e6977}#${MODAL_ID} .hrmos-af-editor-msg.ok{color:#087a32}#${MODAL_ID} .hrmos-af-editor-msg.error{color:#b42318}
      @media(max-width:760px){#${PANEL_ID}{min-width:0;max-width:calc(100vw - 12px);resize:none}#${MODAL_ID} .hrmos-af-dialog{min-width:0;min-height:0;max-width:calc(100vw - 12px);max-height:calc(100vh - 12px);resize:none}#${MODAL_ID} .profile-manager{grid-template-columns:1fr}#${MODAL_ID} .profile-actions{flex-wrap:wrap}#${MODAL_ID} .editor-grid{grid-template-columns:1fr}#${MODAL_ID} .editor-field.wide,#${MODAL_ID} .editor-check.wide{grid-column:auto}#${MODAL_ID} .hrmos-af-dialog-actions{flex-wrap:wrap}#${MODAL_ID} .hrmos-af-dialog-actions .hrmos-af-editor-msg{order:3;flex-basis:100%}}
    `);
  }

  function init() {
    installStyles();
    createPanel();
    highlightManualItems();
    GM_registerMenuCommand?.('求人応募: プロフィールを編集', openProfileEditor);
    GM_registerMenuCommand?.('求人応募: 入力', () => autofill());
    GM_registerMenuCommand?.('求人応募: 項目確認', scanForm);

    const observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        if (!document.getElementById(PANEL_ID)) createPanel();
      }, 160);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
