// [稼働Ver 作業版 Rev.15] 正式版 v1.0.3：スマホ完全両対応タブ切り替え、Mermaid縦パディング拡張（3〜4行文字切れ完全根絶）、画像圧縮・判断材料表自動生成維持

const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODEL = 'gemini-flash-lite-latest';
const STORAGE_KEY_API = 'gemini_dual_hub_api_key';
const STORAGE_KEY_CANVAS = 'gemini_dual_hub_canvas_data';
const STORAGE_KEY_CHAT = 'gemini_dual_hub_chat_history';
const STORAGE_KEY_THEME = 'gemini_dual_hub_theme';
const STORAGE_KEY_THINKING_MODE = 'gemini_dual_hub_thinking_mode';
const REQUEST_TIMEOUT_MS = 45000; // 45秒タイムアウト
const MIN_REQUEST_INTERVAL_MS = 4000; // 429防止用最低インターバル4秒

// 過去逆戻り防止用 下限年月ガード（2026年11月）
const BASE_FLOOR_YEAR = 2026;
const BASE_FLOOR_MONTH = 11;

// 3段階思考スタンス定義
const THINKING_MODES = {
  creative: {
    temperature: 1.0,
    label: '🚀 ひらめき・発想',
    instruction: '\n【思考スタンス：🚀 ひらめき重視】常識や枠組みに囚われず、飛躍した仮説、ユニークな比喩、大胆でクリエイティブなアイディアを積極的に提案してください。多少アバウトでも発想を広げることを最優先してください。'
  },
  balanced: {
    temperature: 0.7,
    label: '⚖️ 標準バランス',
    instruction: '\n【思考スタンス：⚖️ 標準バランス】自由で柔軟な発想と、論理的な一貫性のバランスを保ちながら、知的で建設的な壁打ちを展開してください。'
  },
  precise: {
    temperature: 0.2,
    label: '🎯 厳密・検証',
    instruction: '\n【思考スタンス：🎯 厳密・検証重視】推測や思い込み、曖昧な表現を徹底的に排除し、確認された客観的事実・Google検索の一次情報・公的データのみに基づいて論理的整合性を厳格に精査してください。不確実な点は断定せず「要確認」と明記してください。'
  }
};

// デフォルトの思考キャンバス初期テンプレート（見える化・判断ナビゲーション型）
const DEFAULT_CANVAS_TEMPLATE = `# 思考キャンバス\n\nここに議論の論点、検討の順番（ロードマップ）、比較表がスマートに見える化・整理されます。\n\n### 【現在の目的・ゴール】\n- （右側のチャットで自由に壁打ちを行い、話が一段落したら上の「更新」ボタンを押してください）\n\n### 【意思決定の手順・ロードマップ】\n（何をどういう順番で決めるべきか、検討ステップのフローチャートがここに自動構築されます）\n\n### 【判断材料・比較表（チャット連携）】\n（チャット内で議論された比較表や検討データが、そのまま漏れなくここに集約されます）\n\n### 【確定した方針・ユーザーの決断】\n- （※ユーザー自身がチャットで明確に「これにする」と決めたことだけがここに記録されます。AIが勝手に決めることはありません）\n\n### 【現在検討中のステップ ＆ 次に答えるべき問い】\n- `;

// アプリケーション状態
const state = {
  currentTheme: 'dark',
  thinkingMode: 'balanced',
  apiKey: '',
  chatHistory: [],
  canvasMarkdown: '',
  canvasBackupSnapshot: '',
  isCanvasEditing: false,
  isCanvasAutoSync: false,
  isSearchGroundingActive: false,
  isRecordingVoice: false,
  isBusy: false,
  lastRequestTime: 0,
  recognitionInstance: null,
  voiceRecordedTranscript: '',
  currentAttachment: null,
  statusResetTimer: null
};

// DOM要素参照
const DOM = {
  // ヘッダー・統合ステータス・テーマ
  selectTheme: document.getElementById('select-theme'),
  unifiedStatusBox: document.getElementById('unified-status-box'),
  statusPulseDot: document.getElementById('status-pulse-dot'),
  statusIcon: document.getElementById('status-icon'),
  statusText: document.getElementById('status-text'),
  btnOpenGuide: document.getElementById('btn-open-guide'),
  btnOpenSettings: document.getElementById('btn-open-settings'),
  btnDownloadAll: document.getElementById('btn-download-all'),
  btnRestoreSession: document.getElementById('btn-restore-session'),
  fileRestoreInput: document.getElementById('file-restore-input'),

  // モバイル専用タブ切替
  tabBtnCanvas: document.getElementById('tab-btn-canvas'),
  tabBtnChat: document.getElementById('tab-btn-chat'),
  panelCanvas: document.getElementById('panel-canvas'),
  panelChat: document.getElementById('panel-chat'),

  // ガイドモーダル
  guideModal: document.getElementById('guide-modal'),
  btnCloseGuide: document.getElementById('btn-close-guide'),
  btnOkGuide: document.getElementById('btn-ok-guide'),

  // 設定モーダル
  settingsModal: document.getElementById('settings-modal'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  btnCancelSettings: document.getElementById('btn-cancel-settings'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  apiKeyInput: document.getElementById('api-key-input'),
  btnToggleKeyVisibility: document.getElementById('btn-toggle-key-visibility'),

  // 図解拡大モーダル
  diagramZoomModal: document.getElementById('diagram-zoom-modal'),
  btnCloseZoom: document.getElementById('btn-close-zoom'),
  diagramZoomBody: document.getElementById('diagram-zoom-body'),

  // 思考キャンバス
  toggleCanvasAuto: document.getElementById('toggle-canvas-auto'),
  btnUpdateCanvas: document.getElementById('btn-update-canvas'),
  btnToggleCanvasEdit: document.getElementById('btn-toggle-canvas-edit'),
  btnCopyCanvas: document.getElementById('btn-copy-canvas'),
  btnDownloadCanvas: document.getElementById('btn-download-canvas'),
  btnClearCanvas: document.getElementById('btn-clear-canvas'),
  canvasPreview: document.getElementById('canvas-preview'),
  canvasEditor: document.getElementById('canvas-editor'),
  canvasLoadingOverlay: document.getElementById('canvas-loading-overlay'),
  canvasLoadingText: document.getElementById('canvas-loading-text'),
  canvasQuotePopup: document.getElementById('canvas-quote-popup'),
  btnQuoteToChat: document.getElementById('btn-quote-to-chat'),

  // 壁打ちチャット
  selectThinkingMode: document.getElementById('select-thinking-mode'),
  toggleSearchGrounding: document.getElementById('toggle-search-grounding'),
  btnClearChat: document.getElementById('btn-clear-chat'),
  chatMessages: document.getElementById('chat-messages'),
  voiceIndicator: document.getElementById('voice-indicator'),
  voiceStatusText: document.getElementById('voice-status-text'),
  btnVoiceInput: document.getElementById('btn-voice-input'),
  fileInput: document.getElementById('file-input'),
  labelFileInput: document.getElementById('label-file-input'),
  inputBoxContainer: document.getElementById('input-box-container'),
  attachmentPreviewContainer: document.getElementById('attachment-preview-container'),
  attachmentPreviewImg: document.getElementById('attachment-preview-img'),
  attachmentName: document.getElementById('attachment-name'),
  btnRemoveAttachment: document.getElementById('btn-remove-attachment'),
  quickChips: document.querySelectorAll('.quick-chip'),
  chatInput: document.getElementById('chat-input'),
  btnSendMessage: document.getElementById('btn-send-message')
};

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
  initMermaid();
  loadStoredSettings();
  initEventListeners();
  initSpeechRecognition();
  await renderCanvas();
  await renderChatHistory();
  autoResizeTextarea();
  updateReadyStatus();
});

// Mermaid.js 公式非破壊初期化（安全な標準テーマ適用＆文字潰れ・文字切れ防止）
function initMermaid() {
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({
      startOnLoad: false,
      theme: state.currentTheme === 'dark' ? 'dark' : 'neutral',
      securityLevel: 'loose',
      fontFamily: 'Inter, Noto Sans JP, sans-serif',
      fontSize: 14,
      flowchart: {
        htmlLabels: true,
        useMaxWidth: true,
        nodeSpacing: 45,
        rankSpacing: 45,
        curve: 'basis',
        padding: 24 /* 3〜4行テキスト時の縦方向クリップ完全防止 */
      },
      suppressErrorRendering: true
    });
  }
}

// テーマ切り替え処理
function applyTheme(themeName) {
  state.currentTheme = themeName;
  document.body.className = `theme-${themeName}`;
  DOM.selectTheme.value = themeName;
  localStorage.setItem(STORAGE_KEY_THEME, themeName);
  initMermaid();
  renderCanvas();
}

// 思考スタンス切り替え
function applyThinkingMode(mode) {
  if (!THINKING_MODES[mode]) mode = 'balanced';
  state.thinkingMode = mode;
  DOM.selectThinkingMode.value = mode;
  localStorage.setItem(STORAGE_KEY_THINKING_MODE, mode);

  if (mode === 'precise' && !state.isSearchGroundingActive) {
    state.isSearchGroundingActive = true;
    DOM.toggleSearchGrounding.checked = true;
    setUnifiedStatus('info', '厳密モード連動：最新Web検索をONにしました', 'fa-globe', 3);
  } else {
    setUnifiedStatus('info', `思考スタンスを「${THINKING_MODES[mode].label}」に切替`, 'fa-sliders', 3);
  }
}

// ストレージ読み込み
function loadStoredSettings() {
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
  if (savedTheme && ['dark', 'light', 'pop'].includes(savedTheme)) {
    applyTheme(savedTheme);
  } else {
    applyTheme('dark');
  }

  const savedMode = localStorage.getItem(STORAGE_KEY_THINKING_MODE);
  if (savedMode && THINKING_MODES[savedMode]) {
    applyThinkingMode(savedMode);
  } else {
    applyThinkingMode('balanced');
  }

  const savedKey = localStorage.getItem(STORAGE_KEY_API);
  if (savedKey) {
    state.apiKey = savedKey;
    DOM.apiKeyInput.value = savedKey;
  } else {
    openSettingsModal();
  }

  const savedCanvas = localStorage.getItem(STORAGE_KEY_CANVAS);
  if (savedCanvas) {
    state.canvasMarkdown = savedCanvas;
    DOM.canvasEditor.value = savedCanvas;
  } else {
    state.canvasMarkdown = DEFAULT_CANVAS_TEMPLATE;
    DOM.canvasEditor.value = state.canvasMarkdown;
  }

  const savedHistory = localStorage.getItem(STORAGE_KEY_CHAT);
  if (savedHistory) {
    try {
      state.chatHistory = JSON.parse(savedHistory);
    } catch (e) {
      state.chatHistory = [];
    }
  }

  DOM.toggleCanvasAuto.checked = false;
  state.isCanvasAutoSync = false;
}

// イベントリスナー登録
function initEventListeners() {
  DOM.btnDownloadAll.addEventListener('click', downloadAllSessionAsMarkdown);
  DOM.btnRestoreSession.addEventListener('click', () => DOM.fileRestoreInput.click());
  DOM.fileRestoreInput.addEventListener('change', handleRestoreFileSelect);

  // モバイル用タブ切り替え
  if (DOM.tabBtnCanvas && DOM.tabBtnChat) {
    DOM.tabBtnCanvas.addEventListener('click', () => switchMobilePanel('canvas'));
    DOM.tabBtnChat.addEventListener('click', () => switchMobilePanel('chat'));
  }

  DOM.selectTheme.addEventListener('change', (e) => {
    applyTheme(e.target.value);
    setUnifiedStatus('info', `テーマを「${e.target.selectedOptions[0].text}」に変更しました`, 'fa-palette', 3);
  });

  DOM.selectThinkingMode.addEventListener('change', (e) => {
    applyThinkingMode(e.target.value);
  });

  DOM.btnOpenGuide.addEventListener('click', openGuideModal);
  DOM.btnCloseGuide.addEventListener('click', closeGuideModal);
  DOM.btnOkGuide.addEventListener('click', closeGuideModal);

  DOM.btnCloseZoom.addEventListener('click', closeDiagramZoomModal);
  DOM.diagramZoomModal.addEventListener('click', (e) => {
    if (e.target === DOM.diagramZoomModal) closeDiagramZoomModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDiagramZoomModal();
  });

  DOM.btnOpenSettings.addEventListener('click', openSettingsModal);
  DOM.btnCloseSettings.addEventListener('click', closeSettingsModal);
  DOM.btnCancelSettings.addEventListener('click', closeSettingsModal);
  DOM.btnSaveSettings.addEventListener('click', saveSettings);
  DOM.btnToggleKeyVisibility.addEventListener('click', toggleKeyVisibility);

  DOM.toggleCanvasAuto.addEventListener('change', (e) => {
    state.isCanvasAutoSync = e.target.checked;
    setUnifiedStatus(
      state.isCanvasAutoSync ? 'info' : 'ready',
      state.isCanvasAutoSync ? 'キャンバス自動同期 ON' : '自動同期 OFF（手動更新推奨）',
      state.isCanvasAutoSync ? 'fa-bolt' : 'fa-circle-check',
      3
    );
  });
  DOM.btnUpdateCanvas.addEventListener('click', () => updateCanvasFromAI(true));
  DOM.btnToggleCanvasEdit.addEventListener('click', toggleCanvasEditMode);
  DOM.btnCopyCanvas.addEventListener('click', copyCanvasToClipboard);
  DOM.btnDownloadCanvas.addEventListener('click', downloadCanvasAsMarkdown);
  DOM.btnClearCanvas.addEventListener('click', clearCanvasContent);
  DOM.canvasEditor.addEventListener('input', handleCanvasEditorInput);

  DOM.canvasPreview.addEventListener('mouseup', handleCanvasTextSelection);
  DOM.btnQuoteToChat.addEventListener('click', applyQuoteToChat);
  document.addEventListener('mousedown', (e) => {
    if (!DOM.canvasQuotePopup.contains(e.target)) {
      DOM.canvasQuotePopup.style.display = 'none';
    }
  });

  DOM.toggleSearchGrounding.addEventListener('change', (e) => {
    state.isSearchGroundingActive = e.target.checked;
    if (state.isSearchGroundingActive) {
      setUnifiedStatus('info', 'Google最新Web検索 有効', 'fa-globe', 4);
    } else {
      updateReadyStatus();
    }
  });
  DOM.btnClearChat.addEventListener('click', clearChatHistory);

  DOM.quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (state.isBusy) return;
      const action = chip.getAttribute('data-action');
      applyQuickChipAction(action);
    });
  });

  DOM.fileInput.addEventListener('change', handleFileSelect);
  DOM.btnRemoveAttachment.addEventListener('click', removeAttachment);
  DOM.chatInput.addEventListener('paste', handlePasteImage);
  initDragAndDrop();

  DOM.btnVoiceInput.addEventListener('click', toggleVoiceRecording);

  DOM.btnSendMessage.addEventListener('click', handleSendMessage);
  DOM.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  DOM.chatInput.addEventListener('input', autoResizeTextarea);
}

// モバイル用パネル切り替えヘルパー
function switchMobilePanel(panelName) {
  if (panelName === 'canvas') {
    DOM.tabBtnCanvas.classList.add('active');
    DOM.tabBtnChat.classList.remove('active');
    DOM.panelCanvas.classList.add('active-panel');
    DOM.panelChat.classList.remove('active-panel');
  } else {
    DOM.tabBtnChat.classList.add('active');
    DOM.tabBtnCanvas.classList.remove('active');
    DOM.panelChat.classList.add('active-panel');
    DOM.panelCanvas.classList.remove('active-panel');
  }
}

// 過去逆戻り防止付き基準年月の動的算出（2026年11月を下限ガード）
function getDynamicReferenceYearMonth() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  if (curYear > BASE_FLOOR_YEAR || (curYear === BASE_FLOOR_YEAR && curMonth >= BASE_FLOOR_MONTH)) {
    return `${curYear}年${curMonth}月`;
  }
  return `${BASE_FLOOR_YEAR}年${BASE_FLOOR_MONTH}月`;
}

// 図解拡大モーダル制御
function openDiagramZoomModal(svgHtml) {
  DOM.diagramZoomBody.innerHTML = svgHtml;
  DOM.diagramZoomModal.style.display = 'flex';
}

function closeDiagramZoomModal() {
  DOM.diagramZoomModal.style.display = 'none';
  DOM.diagramZoomBody.innerHTML = '';
}

// ドラッグ＆ドロップ対応
function initDragAndDrop() {
  const dropZone = DOM.inputBoxContainer;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      processImageFile(files[0]);
    }
  }, false);
}

// ガイドモーダル
function openGuideModal() {
  DOM.guideModal.style.display = 'flex';
}

function closeGuideModal() {
  DOM.guideModal.style.display = 'none';
}

// 統合ステータス管理
function updateReadyStatus() {
  if (state.statusResetTimer) {
    clearTimeout(state.statusResetTimer);
    state.statusResetTimer = null;
  }
  if (!state.apiKey) {
    setUnifiedStatus('warning', 'APIキー未設定', 'fa-triangle-exclamation');
  } else if (state.isSearchGroundingActive) {
    setUnifiedStatus('info', 'Google最新Web検索 有効', 'fa-globe');
  } else {
    setUnifiedStatus('ready', '準備完了', 'fa-circle-check');
  }
}

function setUnifiedStatus(type, text, iconClass = 'fa-circle-check', autoResetSec = 0) {
  if (state.statusResetTimer) {
    clearTimeout(state.statusResetTimer);
    state.statusResetTimer = null;
  }

  DOM.unifiedStatusBox.className = `unified-status-box status-${type}`;
  DOM.statusText.textContent = text;
  DOM.statusText.title = text;
  DOM.statusIcon.className = `fa-solid ${iconClass}`;

  if (autoResetSec > 0) {
    state.statusResetTimer = setTimeout(() => {
      updateReadyStatus();
    }, autoResetSec * 1000);
  }
}

// 送信中多重ロック
function setBusyLock(busy, statusText = '') {
  state.isBusy = busy;
  DOM.chatInput.disabled = busy;
  DOM.btnSendMessage.disabled = busy;
  DOM.btnVoiceInput.disabled = busy;
  DOM.fileInput.disabled = busy;
  DOM.btnUpdateCanvas.disabled = busy;
  DOM.btnClearChat.disabled = busy;
  DOM.btnClearCanvas.disabled = busy;
  DOM.btnDownloadAll.disabled = busy;
  DOM.btnRestoreSession.disabled = busy;

  DOM.quickChips.forEach(chip => {
    chip.disabled = busy;
  });

  if (busy) {
    setUnifiedStatus('busy', statusText || 'Geminiが思考中...', 'fa-spinner fa-spin');
  } else {
    updateReadyStatus();
  }
}

// レートリミット（429）安全インターバル制御
async function ensureRateLimitInterval() {
  const now = Date.now();
  const timeSinceLast = now - state.lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL_MS) {
    const waitMs = MIN_REQUEST_INTERVAL_MS - timeSinceLast;
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  state.lastRequestTime = Date.now();
}

// 設定モーダル
function openSettingsModal() {
  DOM.apiKeyInput.value = state.apiKey;
  DOM.settingsModal.style.display = 'flex';
}

function closeSettingsModal() {
  DOM.settingsModal.style.display = 'none';
}

function toggleKeyVisibility() {
  const isPassword = DOM.apiKeyInput.type === 'password';
  DOM.apiKeyInput.type = isPassword ? 'text' : 'password';
  DOM.btnToggleKeyVisibility.innerHTML = isPassword ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
}

function saveSettings() {
  const key = DOM.apiKeyInput.value.trim();
  if (!key) {
    alert('APIキーを入力してください。');
    return;
  }
  state.apiKey = key;
  localStorage.setItem(STORAGE_KEY_API, key);
  closeSettingsModal();
  setUnifiedStatus('ready', 'APIキーを保存しました', 'fa-circle-check', 4);
}

// クイック指示チップの反映
function applyQuickChipAction(action) {
  const currentText = DOM.chatInput.value.trim();
  let prefix = '';

  switch (action) {
    case 'latest-compare': {
      if (!state.isSearchGroundingActive) {
        state.isSearchGroundingActive = true;
        DOM.toggleSearchGrounding.checked = true;
        setUnifiedStatus('info', '最新比較のためGoogle検索を自動ONにしました', 'fa-globe', 4);
      }
      const refDate = getDynamicReferenceYearMonth();
      prefix = `【時間軸ルール・現行最新モデル比較整理】\n現在は${refDate}です。製品・機種・サービスの比較や情報提示を行う際は、必ず${refDate}時点の発売状況・現行モデルを基準にしてください。旧世代モデルを含める場合は「旧モデル（発売時期）」と明確に区別し、未発売や噂レベルのものは「未発売（予定時期）」と明記してください。確認できない点は推測で断定せず「要確認」としてください。\n\n比較対象/知りたい観点: `;
      break;
    }
    case 'compare':
      prefix = '【比較・検討の観点を深掘り】\n類似品や選択肢について、特徴・メリット・デメリット・価格や適合性を多角的に比較分析してください。\n対象: ';
      break;
    case 'architecture':
      prefix = '【システム連携・構成の検討】\nシステム連携、データフロー、あるいは作業手順の全体のつながりと依存関係を詳しく整理してください。\n要件: ';
      break;
    case 'mindmap':
      prefix = '【全体構造・論点の整理】\nこれまでの議論の全体像と論点の構造（親テーマ・子要素・具体的課題）を体系的に整理してください。\nテーマ: ';
      break;
    case 'slide':
      prefix = '【プレゼン・スライド構成案】\nプレゼン・説明用として、キーメッセージと各スライド構成案（Markdownの --- 区切り）を作成してください。\n目的: ';
      break;
  }

  DOM.chatInput.value = currentText ? `${prefix}\n${currentText}` : prefix;
  autoResizeTextarea();
  DOM.chatInput.focus();
}

// 特殊文字アンエスケープ
function unescapeHtml(html) {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

// Mermaidコード自動修復サニタイザー（文字潰れ・ピンク塗りつぶし等のインラインスタイルを根絶）
function sanitizeMermaidCode(rawText) {
  let clean = unescapeHtml(rawText);
  clean = clean.replace(/^```mermaid\s*/i, '').replace(/```$/i, '').trim();

  // 視認性を破壊するインラインclassDefやstyleの指定を完全除去
  clean = clean.replace(/classDef\s+[\s\S]*?(?=[\r\n]|$)/gi, '');
  clean = clean.replace(/class\s+[\s\S]*?(?=[\r\n]|$)/gi, '');
  clean = clean.replace(/style\s+[\s\S]*?(?=[\r\n]|$)/gi, '');

  clean = clean.replace(/\(\("([\s\S]*?)"\)\)/g, (match, p1) => {
    return `(("${p1.replace(/\r?\n/g, '<br/>')}"))`;
  });
  clean = clean.replace(/\(\(([\s\S]*?)\)\)/g, (match, p1) => {
    return `(("${p1.replace(/\r?\n/g, '<br/>')}"))`;
  });
  clean = clean.replace(/\["([\s\S]*?)"\]/g, (match, p1) => {
    return `["${p1.replace(/\r?\n/g, '<br/>')}"]`;
  });

  return clean.trim();
}

// Mermaid個別安全レンダリング処理
async function renderMermaidSafely(rootElement) {
  if (typeof mermaid === 'undefined') return;

  const codeBlocks = rootElement.querySelectorAll('pre code.language-mermaid, pre code');
  let diagramCount = 0;

  for (const block of codeBlocks) {
    const rawText = block.textContent.trim();
    const isMermaid = block.classList.contains('language-mermaid') ||
      rawText.startsWith('graph ') ||
      rawText.startsWith('flowchart ') ||
      rawText.startsWith('mindmap') ||
      rawText.startsWith('sequenceDiagram') ||
      rawText.startsWith('classDiagram');

    if (!isMermaid) continue;

    diagramCount++;
    const preElement = block.parentElement;
    if (!preElement || !preElement.parentElement) continue;

    const cleanCode = sanitizeMermaidCode(rawText);
    const uniqueId = `mermaid-svg-${Date.now()}-${diagramCount}`;

    try {
      const renderResult = await mermaid.render(uniqueId, cleanCode);
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-wrapper';

      const zoomBtn = document.createElement('button');
      zoomBtn.className = 'btn-zoom-diagram';
      zoomBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i> 拡大';
      zoomBtn.title = '図解を画面一杯に拡大表示';
      zoomBtn.addEventListener('click', () => {
        openDiagramZoomModal(renderResult.svg);
      });

      const container = document.createElement('div');
      container.className = 'mermaid-container';
      container.innerHTML = renderResult.svg;

      wrapper.appendChild(zoomBtn);
      wrapper.appendChild(container);
      preElement.parentElement.replaceChild(wrapper, preElement);
    } catch (err) {
      console.warn('Mermaid render notice (fallback mode):', err);
      const errorTemp = document.getElementById(uniqueId) || document.getElementById('d' + uniqueId);
      if (errorTemp) errorTemp.remove();

      const fallbackBox = document.createElement('div');
      fallbackBox.className = 'mermaid-fallback-box';
      fallbackBox.innerHTML = `
        <div class="mermaid-fallback-header">
          <span><i class="fa-solid fa-bezier-curve"></i> 図解コード（構文調整中）</span>
          <span style="font-size: 0.72rem; opacity: 0.8;">テキストとして安全に保持されています</span>
        </div>
        <div class="mermaid-fallback-content">${escapeHtml(cleanCode)}</div>
      `;
      preElement.parentElement.replaceChild(fallbackBox, preElement);
    }
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// キャンバス描画
async function renderCanvas() {
  if (typeof marked === 'undefined') {
    DOM.canvasPreview.textContent = state.canvasMarkdown;
    return;
  }
  DOM.canvasPreview.innerHTML = marked.parse(state.canvasMarkdown || '');
  await renderMermaidSafely(DOM.canvasPreview);
}

function toggleCanvasEditMode() {
  state.isCanvasEditing = !state.isCanvasEditing;
  if (state.isCanvasEditing) {
    DOM.canvasPreview.style.display = 'none';
    DOM.canvasEditor.style.display = 'block';
    DOM.canvasEditor.value = state.canvasMarkdown;
    DOM.canvasEditor.focus();
    DOM.btnToggleCanvasEdit.innerHTML = '<i class="fa-solid fa-check"></i> 完了';
    DOM.btnToggleCanvasEdit.classList.add('btn-primary');
    DOM.btnToggleCanvasEdit.classList.remove('btn-outline');
    setUnifiedStatus('info', 'キャンバス直接編集中');
  } else {
    state.canvasMarkdown = DOM.canvasEditor.value;
    localStorage.setItem(STORAGE_KEY_CANVAS, state.canvasMarkdown);
    renderCanvas();
    DOM.canvasEditor.style.display = 'none';
    DOM.canvasPreview.style.display = 'block';
    DOM.btnToggleCanvasEdit.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> 編集';
    DOM.btnToggleCanvasEdit.classList.remove('btn-primary');
    DOM.btnToggleCanvasEdit.classList.add('btn-outline');
    setUnifiedStatus('ready', 'キャンバスを清書・保存しました', 'fa-circle-check', 3);
  }
}

function handleCanvasEditorInput(e) {
  state.canvasMarkdown = e.target.value;
  localStorage.setItem(STORAGE_KEY_CANVAS, state.canvasMarkdown);
}

// キャンバスクリア
function clearCanvasContent() {
  if (!confirm('思考キャンバスを初期状態にリセットしますか？\n（右側のチャット履歴はそのまま保持されます）')) return;
  state.canvasMarkdown = DEFAULT_CANVAS_TEMPLATE;
  DOM.canvasEditor.value = state.canvasMarkdown;
  localStorage.setItem(STORAGE_KEY_CANVAS, state.canvasMarkdown);
  renderCanvas();
  setUnifiedStatus('ready', 'キャンバスを初期化しました', 'fa-circle-check', 3);
}

function copyCanvasToClipboard() {
  navigator.clipboard.writeText(state.canvasMarkdown).then(() => {
    setUnifiedStatus('ready', 'キャンバスをコピーしました', 'fa-clipboard-check', 3);
  });
}

function downloadCanvasAsMarkdown() {
  const blob = new Blob([state.canvasMarkdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `canvas_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a);
  setUnifiedStatus('ready', 'キャンバスを保存しました', 'fa-circle-down', 3);
}

// プロジェクト一括保存
function downloadAllSessionAsMarkdown() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let bundleMarkdown = `# プロジェクト思考ログ記録 (${now})\n\n`;
  bundleMarkdown += `## 思考キャンバス（論点・結論ボード）\n\n`;
  bundleMarkdown += `${state.canvasMarkdown}\n\n`;
  bundleMarkdown += `---\n\n`;
  bundleMarkdown += `## 壁打ちチャット全履歴\n\n`;

  if (state.chatHistory.length === 0) {
    bundleMarkdown += `_（チャット履歴はありません）_\n`;
  } else {
    state.chatHistory.forEach((msg, idx) => {
      const sender = msg.role === 'user' ? 'あなた' : 'Gemini';
      bundleMarkdown += `### #${idx + 1} ${sender}\n\n${msg.text}\n\n`;
    });
  }

  const blob = new Blob([bundleMarkdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `project_session_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a);
  setUnifiedStatus('ready', '一括バックアップを保存しました', 'fa-box-archive', 3);
}

// 一括保存Markdownファイルの読み戻し・完全復元パーサー
function handleRestoreFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const fileContent = event.target.result;
      await restoreSessionFromMarkdown(fileContent);
    } catch (err) {
      console.error('Session restore failed:', err);
      alert('ファイルの復元に失敗しました。正しい一括保存ファイル（.md）を選択してください。\n詳細: ' + err.message);
      setUnifiedStatus('danger', 'ファイル復元エラー', 'fa-triangle-exclamation', 4);
    } finally {
      DOM.fileRestoreInput.value = '';
    }
  };
  reader.readAsText(file, 'utf-8');
}

async function restoreSessionFromMarkdown(content) {
  const canvasHeader = '## 思考キャンバス（論点・結論ボード）';
  const chatHeader = '## 壁打ちチャット全履歴';
  const divider = '---';

  const canvasStartIndex = content.indexOf(canvasHeader);
  const dividerIndex = content.indexOf(divider, canvasStartIndex);

  if (canvasStartIndex === -1 || dividerIndex === -1) {
    throw new Error('一括保存ファイルの構造ヘッダーが見つかりません。');
  }

  const restoredCanvasMarkdown = content.substring(
    canvasStartIndex + canvasHeader.length,
    dividerIndex
  ).trim();

  const chatStartIndex = content.indexOf(chatHeader, dividerIndex);
  const restoredChatHistory = [];

  if (chatStartIndex !== -1) {
    const chatSection = content.substring(chatStartIndex + chatHeader.length).trim();
    const msgRegex = /###\s*#\d+\s+(あなた|Gemini)[\r\n]+([\s\S]*?)(?=(?:###\s*#\d+\s+(?:あなた|Gemini)|$))/gi;
    let match;

    while ((match = msgRegex.exec(chatSection)) !== null) {
      const sender = match[1].trim();
      const text = match[2].trim();
      restoredChatHistory.push({
        role: sender === 'あなた' ? 'user' : 'model',
        text: text
      });
    }
  }

  state.canvasMarkdown = restoredCanvasMarkdown || DEFAULT_CANVAS_TEMPLATE;
  state.chatHistory = restoredChatHistory;

  DOM.canvasEditor.value = state.canvasMarkdown;
  localStorage.setItem(STORAGE_KEY_CANVAS, state.canvasMarkdown);
  localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(state.chatHistory));

  await renderCanvas();
  await renderChatHistory();

  setUnifiedStatus('ready', `プロジェクト復元完了（会話: ${restoredChatHistory.length}件）`, 'fa-circle-check', 4);
}

// キャンバステキスト引用
let selectedCanvasText = '';
function handleCanvasTextSelection() {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (text.length > 3) {
    selectedCanvasText = text;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    DOM.canvasQuotePopup.style.left = `${rect.left + rect.width / 2}px`;
    DOM.canvasQuotePopup.style.top = `${rect.top + window.scrollY}px`;
    DOM.canvasQuotePopup.style.display = 'block';
  } else {
    DOM.canvasQuotePopup.style.display = 'none';
  }
}

function applyQuoteToChat() {
  DOM.canvasQuotePopup.style.display = 'none';
  if (!selectedCanvasText) return;
  DOM.chatInput.value = `キャンバスの「${selectedCanvasText}」について、もう少し詳しく深掘りしたいです。\n具体的には: `;
  autoResizeTextarea();
  DOM.chatInput.focus();
}

// 添付ファイル処理（画像選択イベント）
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  processImageFile(file);
}

// クリップボード貼り付け処理
function handlePasteImage(e) {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf('image') === 0) {
      const file = item.getAsFile();
      processImageFile(file);
      break;
    }
  }
}

// クライアントサイド高速画像最適化（長辺1200px・JPEG品質80%に自動リサイズ・圧縮）
function compressImageFile(file, maxDimension = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // 長辺が maxDimension を超える場合のみ縮小（アスペクト比を完全維持）
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64Data = dataUrl.split(',')[1];

        resolve({
          dataUrl: dataUrl,
          base64: base64Data,
          mimeType: 'image/jpeg'
        });
      };
      img.onerror = () => {
        const rawBase64 = event.target.result.split(',')[1];
        resolve({
          dataUrl: event.target.result,
          base64: rawBase64,
          mimeType: file.type || 'image/jpeg'
        });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// 添付画像処理パイプライン
async function processImageFile(file) {
  if (!file.type.startsWith('image/') && !file.name.match(/\.(jpg|jpeg|png|webp|heic|bmp)$/i)) {
    setUnifiedStatus('warning', '画像（PNG, JPEG, WebP）のみ添付可能です', 'fa-triangle-exclamation', 4);
    return;
  }

  setUnifiedStatus('info', '画像を最適化・圧縮中...', 'fa-compress', 2);

  try {
    const compressed = await compressImageFile(file, 1200, 0.8);

    state.currentAttachment = {
      name: file.name,
      mimeType: compressed.mimeType,
      base64: compressed.base64
    };

    DOM.attachmentPreviewImg.src = compressed.dataUrl;
    DOM.attachmentName.textContent = file.name;
    DOM.attachmentPreviewContainer.style.display = 'flex';

    setUnifiedStatus('ready', '画像を最適化して添付しました', 'fa-circle-check', 3);
  } catch (err) {
    console.error('Image compression error:', err);
    setUnifiedStatus('danger', '画像の処理に失敗しました', 'fa-triangle-exclamation', 4);
  }
}

function removeAttachment() {
  state.currentAttachment = null;
  DOM.fileInput.value = '';
  DOM.attachmentPreviewImg.src = '';
  DOM.attachmentName.textContent = '';
  DOM.attachmentPreviewContainer.style.display = 'none';
}

// 音声入力
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    DOM.btnVoiceInput.style.display = 'none';
    return;
  }
  if (!state.recognitionInstance) {
    state.recognitionInstance = new SpeechRecognition();
    state.recognitionInstance.lang = 'ja-JP';
    state.recognitionInstance.continuous = true;
    state.recognitionInstance.interimResults = true;

    state.recognitionInstance.onresult = (event) => {
      let interim = '';
      let finals = '';
      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finals += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      state.voiceRecordedTranscript = finals || interim;
      DOM.voiceStatusText.textContent = state.voiceRecordedTranscript || '音声を聞き取り中...';
    };

    state.recognitionInstance.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      stopVoiceRecording(false);
    };

    state.recognitionInstance.onend = () => {
      if (state.isRecordingVoice) {
        stopVoiceRecording(true);
      }
    };
  }
}

function toggleVoiceRecording() {
  if (state.isBusy) return;
  if (!state.isRecordingVoice) {
    startVoiceRecording();
  } else {
    stopVoiceRecording(true);
  }
}

function startVoiceRecording() {
  if (!state.recognitionInstance) return;
  state.isRecordingVoice = true;
  state.voiceRecordedTranscript = '';
  DOM.btnVoiceInput.classList.add('recording');
  DOM.voiceIndicator.style.display = 'flex';
  DOM.voiceStatusText.textContent = '話しかけてください（話し終えたらマイクを再押下）...';
  try {
    state.recognitionInstance.start();
  } catch (e) {
    console.warn(e);
  }
}

async function stopVoiceRecording(shouldProcess = true) {
  if (!state.isRecordingVoice) return;
  state.isRecordingVoice = false;
  DOM.btnVoiceInput.classList.remove('recording');
  try {
    state.recognitionInstance.stop();
  } catch (e) {}

  if (!shouldProcess || !state.voiceRecordedTranscript.trim()) {
    DOM.voiceIndicator.style.display = 'none';
    return;
  }

  DOM.voiceStatusText.textContent = 'フィラー除去・整形中...';
  const rawText = state.voiceRecordedTranscript.trim();

  try {
    const formatted = await formatVoiceTextWithAI(rawText);
    const existing = DOM.chatInput.value.trim();
    DOM.chatInput.value = existing ? `${existing} ${formatted}` : formatted;
    autoResizeTextarea();

    DOM.chatInput.classList.remove('highlight-green-pulse');
    void DOM.chatInput.offsetWidth;
    DOM.chatInput.classList.add('highlight-green-pulse');
    setTimeout(() => {
      DOM.chatInput.classList.remove('highlight-green-pulse');
    }, 2000);

  } catch (err) {
    console.error('Voice cleanup failed:', err);
    DOM.chatInput.value += rawText;
  } finally {
    DOM.voiceIndicator.style.display = 'none';
    DOM.chatInput.focus();
  }
}

async function formatVoiceTextWithAI(rawText) {
  const prompt = `以下の音声認識テキストから、「えー」「あのー」「えっと」などの不要なフィラーを取り除き、文意を損なわずに1文単位で自然な句読点（、。）を付与して整形してください。出力は整形後のテキストのみを返してください。\n\n音声テキスト:\n${rawText}`;
  const response = await callGeminiAPI([{ role: 'user', parts: [{ text: prompt }] }], null, false, 0.2);
  return response.text.trim();
}

function autoResizeTextarea() {
  DOM.chatInput.style.height = 'auto';
  DOM.chatInput.style.height = `${Math.min(DOM.chatInput.scrollHeight, 140)}px`;
}

// チャット履歴レンダリング（同期ループによる時系列順序の完全保証）
async function renderChatHistory() {
  if (state.chatHistory.length === 0) {
    DOM.chatMessages.innerHTML = `
      <div class="system-intro-card">
        <div class="intro-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <h3>自由な発想で壁打ちを始めましょう</h3>
        <p>アイディアの相談や論理の深掘りを普段通り投げかけてください。「思考」からひらめき・標準・厳密を切り替えられます。最新の外部情報が必要な時は「最新Web検索」をONにします。キャンバス側が論点整理とビジュアル図解を自動で行います。</p>
      </div>`;
    return;
  }

  DOM.chatMessages.innerHTML = '';
  for (let idx = 0; idx < state.chatHistory.length; idx++) {
    const msg = state.chatHistory[idx];
    await appendMessageToDOM(msg.role, msg.text, msg.image, false, idx);
  }
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

// チャットメッセージ追加
async function appendMessageToDOM(role, text, image = null, scroll = true, msgIndex = null) {
  const container = document.createElement('div');
  container.className = `chat-bubble-container ${role}`;

  const sender = document.createElement('div');
  sender.className = 'bubble-sender';
  if (role === 'user') {
    sender.innerHTML = '<i class="fa-solid fa-user"></i> あなた';
  } else {
    sender.innerHTML = '<i class="fa-solid fa-sparkles text-gradient"></i> Gemini';
  }
  container.appendChild(sender);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (image && image.base64) {
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'bubble-attachment';
    const imgEl = document.createElement('img');
    imgEl.src = `data:${image.mimeType};base64,${image.base64}`;
    imgWrapper.appendChild(imgEl);
    bubble.appendChild(imgWrapper);
  }

  const textDiv = document.createElement('div');
  if (role === 'model' && typeof marked !== 'undefined') {
    const cleanContent = text.replace(/\[SUGGEST_SEARCH:?.*?\]/gi, '').trim();
    textDiv.innerHTML = marked.parse(cleanContent || text);
    await renderMermaidSafely(textDiv);
  } else {
    textDiv.textContent = text;
  }

  bubble.appendChild(textDiv);
  container.appendChild(bubble);
  DOM.chatMessages.appendChild(container);

  if (scroll) {
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
  }
}

function clearChatHistory() {
  if (state.isBusy) return;
  if (!confirm('チャットの会話履歴をクリアしますか？\n（思考キャンバスの内容はそのまま安全に保持されます）')) return;
  state.chatHistory = [];
  localStorage.removeItem(STORAGE_KEY_CHAT);
  renderChatHistory();
  setUnifiedStatus('ready', '会話履歴をリセットしました', 'fa-circle-check', 3);
}

// メッセージ送信処理
async function handleSendMessage() {
  if (state.isBusy) return;

  const text = DOM.chatInput.value.trim();
  const attachment = state.currentAttachment;
  if (!text && !attachment) return;

  if (!state.apiKey) {
    setUnifiedStatus('warning', 'APIキーが未設定です', 'fa-triangle-exclamation', 4);
    openSettingsModal();
    return;
  }

  const userMsg = {
    role: 'user',
    text: text,
    image: attachment ? { ...attachment } : null
  };
  state.chatHistory.push(userMsg);
  await appendMessageToDOM('user', text, userMsg.image, true);

  DOM.chatInput.value = '';
  autoResizeTextarea();
  removeAttachment();

  try {
    localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(state.chatHistory));
  } catch (storageErr) {
    console.warn('LocalStorage save failed (quota exceeded):', storageErr);
  }

  setBusyLock(true, state.isSearchGroundingActive ? 'Google検索を交えて思考中...' : 'Geminiが回答を生成中...');

  try {
    await ensureRateLimitInterval();

    const modeConfig = THINKING_MODES[state.thinkingMode] || THINKING_MODES.balanced;
    const dynamicSystemInstruction = CHAT_SYSTEM_INSTRUCTION + modeConfig.instruction;

    const formattedHistory = buildGeminiContents(state.chatHistory);
    const apiResult = await callGeminiAPI(
      formattedHistory,
      dynamicSystemInstruction,
      state.isSearchGroundingActive,
      modeConfig.temperature
    );

    state.chatHistory.push({ role: 'model', text: apiResult.text });
    try {
      localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(state.chatHistory));
    } catch (storageErr) {
      console.warn('LocalStorage save failed:', storageErr);
    }

    await appendMessageToDOM('model', apiResult.text, null, true);

    setUnifiedStatus('ready', '回答を受信しました', 'fa-circle-check', 3);

    if (state.isCanvasAutoSync) {
      setTimeout(() => {
        updateCanvasFromAI(false);
      }, 2000);
    }
  } catch (err) {
    console.error('Chat API Error:', err);
    setUnifiedStatus('danger', `通信エラー: ${err.message}`, 'fa-circle-exclamation', 5);
    await appendMessageToDOM('model', `⚠️ エラーが発生しました: ${err.message}`);
  } finally {
    setBusyLock(false);
  }
}

// Gemini送信ペイロード構築
function buildGeminiContents(history) {
  const total = history.length;
  return history.map((msg, index) => {
    const parts = [];
    const isRecent = (total - index) <= 6;
    if (msg.image && msg.image.base64 && isRecent) {
      parts.push({
        inlineData: {
          mimeType: msg.image.mimeType,
          data: msg.image.base64
        }
      });
    }
    if (msg.text) {
      parts.push({ text: msg.text });
    }
    return {
      role: msg.role === 'model' ? 'model' : 'user',
      parts: parts
    };
  });
}

// チャット専用プロンプト基本骨格
const CHAT_SYSTEM_INSTRUCTION = `あなたはユーザーの最高の壁打ち・思考パートナーです。
ユーザーの頭の中のアイディアを徹底的に広げ、議論を深めてください。
型にはまった定型要約は不要です。質問・相談に対して、常に直接的かつ具体的に回答文章・考察・深掘り・最新の知見を展開してください。
※図解（Mermaid）の作成に気を取られる必要はありません。ユーザーの言葉の本質を捉え、知的なディスカッションに没頭してください（直感的な説明のために自発的に図を交えることは歓迎します）。`;

// キャンバス専用プロンプト（ユーザー主権型：勝手な決定の厳格禁止 ＆ 判断手順ナビゲーション）
const CANVAS_LOGIC_SYSTEM_INSTRUCTION = `あなたはユーザーの「思考の見える化・判断ナビゲーション盤」を作成する専門エンジニアです。
キャンバスは【結論を急ぐ場】ではなく、【何をどういう順番で決めるべきか（手順・ロードマップ）】と【各ステップでの判断材料（比較検討）】を美しく整理してユーザーに提示するダッシュボードです。

【最重要ルール：AIによる勝手な決定・決めつけの完全禁止】
- ユーザー自身がチャット内で明確に「これにする」「これで決定する」と宣言・承諾していない事項は、絶対に【確定した方針・ユーザーの決断】に書いてはなりません。
- AI側が強く推奨した案や、現在比較検討中の事項は、すべて「検討中の論点」として扱い、ユーザーの判断待ちであることを明記してください。勝手に決定事項へ格上げすることは重大なバグとみなします。

出力フォーマット（必ず以下のセクション構成を厳守してください）：

### 【現在の目的・ゴール】
- ユーザーの本音の目的や動機、絶対に避けたい失敗（ガッカリ感）を明確に記述する。

### 【確定した方針・ユーザーの決断】
- 【ユーザーが明示的に決断・合意した事項のみ】を箇条書きで記載する。
- まだユーザーが選定・決断を下していない場合は「- （※現在ステップ1の比較検討中。ユーザーの決断待ち）」とだけ明記し、絶対にAIの推奨案で埋めないこと。

### 【現在検討中のステップ ＆ ユーザーへの問いかけ】
- **[いま検討中の論点]**:
  - （例：裁断機・スキャナーの選定において、初期投資と手間のどちらを優先するか等、具体的な機種名・数字を交えて対立軸を記述）
- **[次にチャットでユーザーが決めるべき問い]**:
  - ❓ （ユーザーが比較表やロードマップを見て、右のチャットで次に答えるべき具体的な選択の問いを1〜2点提示する）

※無駄な挨拶や解説は出力せず、Markdown本文のみを出力してください。`;

// Gemini API 呼び出しコアロジック
async function callGeminiAPI(contents, systemInstructionText = null, useSearch = false, temperatureValue = 0.7) {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const isFallback = i > 0;

    if (isFallback) {
      setUnifiedStatus('warning', `予備モデル(${model})へ自動切替中...`, 'fa-arrows-rotate');
      await new Promise(r => setTimeout(r, 1200));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.apiKey}`;
      const payload = {
        contents: contents,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: temperatureValue
        }
      };

      if (systemInstructionText) {
        payload.systemInstruction = {
          parts: [{ text: systemInstructionText }]
        };
      }

      if (useSearch) {
        payload.tools = [{ googleSearch: {} }];
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok && useSearch) {
        console.warn(`Search grounding quota hit or rejected on ${model}. Gracefully falling back to standard prompt...`);
        setUnifiedStatus('info', '検索枠調整のため標準モードで回答生成中...', 'fa-brain');
        return await callGeminiAPI(contents, systemInstructionText, false, temperatureValue);
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${res.status} (${res.statusText})`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const text = candidate?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error('モデルから有効な回答テキストが得られませんでした。');
      }

      return {
        text: text,
        model: model,
        finishReason: finishReason
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      const errMsg = isTimeout ? `リクエストが${REQUEST_TIMEOUT_MS / 1000}秒でタイムアウトしました` : err.message;
      console.warn(`Model ${model} attempt failed: ${errMsg}`);
      lastError = new Error(`${model}: ${errMsg}`);
    }
  }

  throw lastError || new Error('すべてのGeminiモデルで呼び出しに失敗しました。');
}

// チャット履歴から「全Markdown比較表」および「最新Mermaid」を無欠損で回収
function extractVisualArtifactsFromChat(chatHistory) {
  let latestMermaid = null;
  const collectedTables = [];

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    if (msg.role !== 'model' || !msg.text) continue;

    if (!latestMermaid) {
      const mermaidMatch = msg.text.match(/```[\s]*mermaid[\r\n]+([\s\S]*?)```/i);
      if (mermaidMatch) {
        latestMermaid = `\`\`\`mermaid\n${sanitizeMermaidCode(mermaidMatch[1])}\n\`\`\``;
      }
    }

    const tableRegex = /\|(.+)\|[\r\n]+\|[-:| ]+\|[\r\n]+((?:\|.+[\r\n]*)+)/g;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(msg.text)) !== null) {
      const fullTable = tableMatch[0].trim();
      if (!collectedTables.some(t => t.includes(tableMatch[1].trim()))) {
        collectedTables.unshift(fullTable);
      }
    }
  }

  return { mermaid: latestMermaid, tables: collectedTables };
}

// 思考キャンバス 統合更新パイプライン
async function updateCanvasFromAI(isManual = false) {
  if (state.chatHistory.length === 0) {
    if (isManual) {
      setUnifiedStatus('info', 'まず右側のチャットで会話を開始してください', 'fa-info-circle', 4);
    }
    return;
  }

  if (state.isBusy) return;

  state.canvasBackupSnapshot = state.canvasMarkdown;
  DOM.canvasLoadingOverlay.style.display = 'flex';
  DOM.canvasLoadingText.textContent = '思考のロードマップと比較表を整理中...';
  setBusyLock(true, 'キャンバスを可視化同期中...');

  try {
    await ensureRateLimitInterval();

    const conversationLog = state.chatHistory.map((m) => `${m.role === 'user' ? 'ユーザー' : 'Gemini'}: ${m.text}`).join('\n\n');

    // 1. 論理テキスト生成
    const logicPrompt = `これまでの会話ログを分析し、ユーザーが「何をどういう順番で決めるべきか」の検討状況を整理してください。ユーザーが決めていない提案を勝手に決定事項に含めてはなりません。\n\n【会話ログ】:\n${conversationLog}`;
    const logicResult = await callGeminiAPI(
      [{ role: 'user', parts: [{ text: logicPrompt }] }],
      CANVAS_LOGIC_SYSTEM_INSTRUCTION,
      false,
      0.2
    );

    const logicMarkdown = logicResult.text.trim();

    // 2. 検討手順フローチャート（ロードマップ）の構築
    const artifacts = extractVisualArtifactsFromChat(state.chatHistory);
    let roadmapMermaid = artifacts.mermaid;

    if (!roadmapMermaid) {
      await ensureRateLimitInterval();
      const roadmapPrompt = `以下の会話ログから、ユーザーがプロジェクトを完遂するために「何をどの順番で検討・決定していくべきか」のステップ手順（ロードマップ）をMermaid記法の flowchart TD で作成してください。
※重要：styleやclassDef、色の指定は一切含めないでください。純粋なノード構造のみを出力してください。ノード内の日本語は A["ステップ名<br/>説明"] と囲んでください。\n\n【会話ログ】:\n${conversationLog}`;

      const roadmapResult = await callGeminiAPI(
        [{ role: 'user', parts: [{ text: roadmapPrompt }] }],
        null,
        false,
        0.2
      );
      const generatedCode = roadmapResult.text.match(/```[\s]*mermaid[\r\n]+([\s\S]*?)```/i);
      roadmapMermaid = generatedCode ? `\`\`\`mermaid\n${sanitizeMermaidCode(generatedCode[1])}\n\`\`\`` : `\`\`\`mermaid\nflowchart TD\n    Step1["ステップ1: 現状確認と基本対応"] --> Step2["ステップ2: 調整と深掘り"]\n    Step2 --> Step3["ステップ3: 解決・完了"]\n\`\`\``;
    }

    // 3. 判断材料・比較表セクションの構築
    let tablesMarkdown = '';
    if (artifacts.tables && artifacts.tables.length > 0) {
      tablesMarkdown = artifacts.tables.join('\n\n');
    } else {
      await ensureRateLimitInterval();
      const tableFallbackPrompt = `以下の会話ログを分析し、ユーザーが客観的な判断を下すための「判断材料・比較表」をMarkdownの表（Table）形式で作成してください。
（例：選択肢の比較、メリット・デメリット、難易度・費用・所要時間、原因別の切り分け基準など、会話の主題に最も適した比較表を作成）
※重要：AIが勝手に結論を決めつけず、判断のための客観的な基準を示す表にしてください。Markdownの表のみを出力してください。\n\n【会話ログ】:\n${conversationLog}`;

      try {
        const tableFallbackResult = await callGeminiAPI(
          [{ role: 'user', parts: [{ text: tableFallbackPrompt }] }],
          null,
          false,
          0.2
        );
        const tableMatch = tableFallbackResult.text.match(/\|(.+)\|[\r\n]+\|[-:| ]+\|[\r\n]+((?:\|.+[\r\n]*)+)/);
        if (tableMatch) {
          tablesMarkdown = tableMatch[0].trim();
        } else {
          tablesMarkdown = `_（右側のチャットで比較検討が進むと、ここに詳細な比較表が自動的にピン留めされます）_`;
        }
      } catch (tableErr) {
        console.warn('Fallback table generation failed, defaulting to placeholder:', tableErr);
        tablesMarkdown = `_（右側のチャットで比較検討が進むと、ここに詳細な比較表が自動的にピン留めされます）_`;
      }
    }

    // 4. キャンバス全体の再構築
    let finalCanvasMarkdown = '# 思考キャンバス\n\n';

    const goalSection = extractSection(logicMarkdown, '【現在の目的・ゴール】');
    const decisionSection = extractSection(logicMarkdown, '【確定した方針・ユーザーの決断】') || extractSection(logicMarkdown, '【決定事項・確定方針】');
    const stepSection = extractSection(logicMarkdown, '【現在検討中のステップ ＆ ユーザーへの問いかけ】') || extractSection(logicMarkdown, '【現在検討中の論点（対立軸・トレードオフ）】') || extractSection(logicMarkdown, '【現在検討中の論点】');

    if (goalSection) {
      finalCanvasMarkdown += `### 【現在の目的・ゴール】\n${goalSection}\n\n`;
    }

    finalCanvasMarkdown += `### 【意思決定の手順・ロードマップ】\n${roadmapMermaid}\n\n`;

    finalCanvasMarkdown += `### 【判断材料・比較表（チャット連携）】\n${tablesMarkdown}\n\n`;

    if (decisionSection) {
      finalCanvasMarkdown += `### 【確定した方針・ユーザーの決断】\n${decisionSection}\n\n`;
    }

    if (stepSection) {
      finalCanvasMarkdown += `### 【現在検討中のステップ ＆ ユーザーへの問いかけ】\n${stepSection}\n`;
    }

    state.canvasMarkdown = finalCanvasMarkdown.trim();
    DOM.canvasEditor.value = state.canvasMarkdown;
    localStorage.setItem(STORAGE_KEY_CANVAS, state.canvasMarkdown);
    await renderCanvas();

    setUnifiedStatus('ready', '思考キャンバスを最新に同期しました', 'fa-circle-check', 4);
  } catch (err) {
    console.error('Canvas sync failed, executing rollback:', err);
    state.canvasMarkdown = state.canvasBackupSnapshot;
    DOM.canvasEditor.value = state.canvasMarkdown;
    localStorage.setItem(STORAGE_KEY_CANVAS, state.canvasMarkdown);
    await renderCanvas();

    setUnifiedStatus('danger', `キャンバス復旧: 直前の状態にロールバックしました`, 'fa-triangle-exclamation', 5);
  } finally {
    DOM.canvasLoadingOverlay.style.display = 'none';
    setBusyLock(false);
  }
}

// Markdownセクション切り出しヘルパー
function extractSection(markdown, sectionTitle) {
  const pattern = new RegExp(`###\\s*${escapeRegExp(sectionTitle)}[\\r\\n]+([\\s\\S]*?)(?=(?:###\\s*【|$))`, 'i');
  const match = markdown.match(pattern);
  return match ? match[1].trim() : '';
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}