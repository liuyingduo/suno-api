/**
 * 补环境方案：在 Node.js 里伪造浏览器环境，运行 hCaptcha bundle，
 * 拦截它的 fetch 请求，获取 success: true 的 token。
 */

import fs from 'fs';
import vm from 'vm';
import https from 'https';
import http from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fileURLToPath } from 'url';
import path from 'path';
import { randomFillSync, randomUUID, webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY = 'http://127.0.0.1:7897';
const proxyAgent = new HttpsProxyAgent(PROXY);
const SITEKEY = 'd65453de-3f1a-4aac-9366-a0f06e52b2ce';
const HOST = 'suno.com';

// ─── 1. 真实 Chrome window 的全局键（Object.keys(window) 的典型结果）────────
// 这是 Chrome 148 on Windows 的典型 window keys，用于伪造 wdata 指纹
const CHROME_WINDOW_KEYS = [
  "0","1","window","self","document","name","location","customElements","history",
  "navigation","locationbar","menubar","personalbar","scrollbars","statusbar",
  "toolbar","status","closed","frames","length","top","opener","parent","frameElement",
  "navigator","origin","external","screen","innerWidth","innerHeight","scrollX",
  "pageXOffset","scrollY","pageYOffset","visualViewport","screenX","screenY",
  "outerWidth","outerHeight","devicePixelRatio","event","clientInformation",
  "offscreenBuffering","screenLeft","screenTop","defaultStatus","defaultstatus",
  "styleMedia","onsearch","isSecureContext","queryLocalFonts","trustedTypes",
  "performance","onappinstalled","onbeforeinstallprompt","crypto","indexedDB",
  "sessionStorage","localStorage","onload","onbeforeunload","onunload","onpagehide",
  "onpageshow","onpopstate","onstorage","onhashchange","onlanguagechange",
  "onmessage","onmessageerror","onrejectionhandled","onunhandledrejection",
  "ondevicemotion","ondeviceorientation","ondeviceorientationabsolute",
  "oncontextmenu","onblur","onfocus","oncancel","onauxclick","onbeforeinput",
  "onclick","onclose","oncuechange","ondblclick","ondrag","ondragend","ondragenter",
  "ondragleave","ondragover","ondragstart","ondrop","ondurationchange","onemptied",
  "onended","onerror","oninput","oninvalid","onkeydown","onkeypress","onkeyup",
  "onmousedown","onmouseenter","onmouseleave","onmousemove","onmouseout",
  "onmouseover","onmouseup","onmousewheel","onpause","onplay","onplaying",
  "onprogress","onratechange","onreset","onresize","onscroll","onsecuritypolicyviolation",
  "onseeked","onseeking","onselect","onslotchange","onstalled","onsubmit",
  "onsuspend","ontimeupdate","ontoggle","onvolumechange","onwaiting","onwebkitanimationend",
  "onwebkitanimationiteration","onwebkitanimationstart","onwebkittransitionend",
  "onwheel","onpointercancel","onpointerdown","onpointerenter","onpointerleave",
  "onpointermove","onpointerout","onpointerover","onpointerrawupdate","onpointerup",
  "ongotpointercapture","onlostpointercapture","onselectionchange",
  "onselectstart","onanimationend","onanimationiteration","onanimationstart",
  "ontransitioncancel","ontransitionend","ontransitionrun","ontransitionstart",
  "onafterprint","onbeforeprint","onbeforematch","onbeforetoggle",
  "AbortController","AbortSignal","AbstractRange","AnalyserNode","Animation",
  "AnimationEffect","AnimationEvent","AnimationPlaybackEvent","AnimationTimeline",
  "Attr","AudioBuffer","AudioBufferSourceNode","AudioContext","AudioData",
  "AudioDecoder","AudioDestinationNode","AudioEncoder","AudioListener","AudioNode",
  "AudioParam","AudioParamMap","AudioProcessingEvent","AudioScheduledSourceNode",
  "AudioSinkInfo","AudioWorklet","AudioWorkletNode","BackgroundFetchManager",
  "BackgroundFetchRecord","BackgroundFetchRegistration","BarProp","BaseAudioContext",
  "BeforeInstallPromptEvent","BeforeUnloadEvent","BiquadFilterNode","Blob","BlobEvent",
  "BroadcastChannel","ByteLengthQueuingStrategy","CDATASection","CSSAnimation",
  "CSSConditionRule","CSSContainerRule","CSSCounterStyleRule","CSSFontFaceRule",
  "CSSFontPaletteValuesRule","CSSGroupingRule","CSSImportRule","CSSKeyframeRule",
  "CSSKeyframesRule","CSSLayerBlockRule","CSSLayerStatementRule","CSSMediaRule",
  "CSSNamespaceRule","CSSPageRule","CSSPropertyRule","CSSRule","CSSRuleList",
  "CSSStyleDeclaration","CSSStyleRule","CSSStyleSheet","CSSSupportsRule",
  "CSSTransition","Cache","CacheStorage","CanvasCaptureMediaStreamTrack",
  "CanvasGradient","CanvasPattern","CanvasRenderingContext2D","ChannelMergerNode",
  "ChannelSplitterNode","CharacterData","Clipboard","ClipboardEvent","ClipboardItem",
  "CloseEvent","Comment","CompositionEvent","CompressionStream","ConstantSourceNode",
  "ContentVisibilityAutoStateChangeEvent","ConvolverNode","CountQueuingStrategy",
  "Credential","CredentialsContainer","CryptoKey","CustomElementRegistry",
  "CustomEvent","DOMError","DOMException","DOMImplementation","DOMMatrix",
  "DOMMatrixReadOnly","DOMParser","DOMPoint","DOMPointReadOnly","DOMQuad",
  "DOMRect","DOMRectList","DOMRectReadOnly","DOMStringList","DOMStringMap",
  "DOMTokenList","DataTransfer","DataTransferItem","DataTransferItemList",
  "DecompressionStream","DelayNode","DeviceMotionEvent","DeviceOrientationEvent",
  "Document","DocumentFragment","DocumentTimeline","DocumentType","DragEvent",
  "DynamicsCompressorNode","Element","ElementInternals","EncodedAudioChunk",
  "EncodedVideoChunk","ErrorEvent","Event","EventCounts","EventSource","EventTarget",
  "External","FeaturePolicy","File","FileList","FileReader","FileSystemDirectoryEntry",
  "FileSystemDirectoryHandle","FileSystemDirectoryReader","FileSystemEntry",
  "FileSystemFileEntry","FileSystemFileHandle","FileSystemHandle",
  "FileSystemWritableFileStream","FocusEvent","FontData","FontFace","FontFaceSet",
  "FontFaceSetLoadEvent","FormData","FragmentDirective","GainNode","Gamepad",
  "GamepadButton","GamepadEvent","GamepadHapticActuator","HTMLAllCollection",
  "HTMLAnchorElement","HTMLAreaElement","HTMLAudioElement","HTMLBRElement",
  "HTMLBaseElement","HTMLBodyElement","HTMLButtonElement","HTMLCanvasElement",
  "HTMLCollection","HTMLDListElement","HTMLDataElement","HTMLDataListElement",
  "HTMLDetailsElement","HTMLDialogElement","HTMLDirectoryElement","HTMLDivElement",
  "HTMLDocument","HTMLElement","HTMLEmbedElement","HTMLFieldSetElement",
  "HTMLFontElement","HTMLFormControlsCollection","HTMLFormElement","HTMLFrameElement",
  "HTMLFrameSetElement","HTMLHRElement","HTMLHeadElement","HTMLHeadingElement",
  "HTMLHtmlElement","HTMLIFrameElement","HTMLImageElement","HTMLInputElement",
  "HTMLLIElement","HTMLLabelElement","HTMLLegendElement","HTMLLinkElement",
  "HTMLMapElement","HTMLMarqueeElement","HTMLMediaElement","HTMLMenuElement",
  "HTMLMetaElement","HTMLMeterElement","HTMLModElement","HTMLOListElement",
  "HTMLObjectElement","HTMLOptGroupElement","HTMLOptionElement","HTMLOptionsCollection",
  "HTMLOutputElement","HTMLParagraphElement","HTMLParamElement","HTMLPictureElement",
  "HTMLPreElement","HTMLProgressElement","HTMLQuoteElement","HTMLScriptElement",
  "HTMLSelectElement","HTMLSlotElement","HTMLSourceElement","HTMLSpanElement",
  "HTMLStyleElement","HTMLTableCaptionElement","HTMLTableCellElement",
  "HTMLTableColElement","HTMLTableElement","HTMLTableRowElement",
  "HTMLTableSectionElement","HTMLTemplateElement","HTMLTextAreaElement",
  "HTMLTimeElement","HTMLTitleElement","HTMLTrackElement","HTMLUListElement",
  "HTMLUnknownElement","HTMLVideoElement","HashChangeEvent","Headers",
  "History","IDBCursor","IDBCursorWithValue","IDBDatabase","IDBFactory",
  "IDBIndex","IDBKeyRange","IDBObjectStore","IDBOpenDBRequest","IDBRequest",
  "IDBTransaction","IDBVersionChangeEvent","IIRFilterNode","IdleDeadline",
  "ImageBitmap","ImageBitmapRenderingContext","ImageCapture","ImageData",
  "InputDeviceCapabilities","InputDeviceInfo","InputEvent","IntersectionObserver",
  "IntersectionObserverEntry","KeyboardEvent","KeyframeEffect","LargestContentfulPaint",
  "LayoutShift","LayoutShiftAttribution","Location","MIDIAccess","MIDIConnectionEvent",
  "MIDIInput","MIDIInputMap","MIDIMessageEvent","MIDIOutput","MIDIOutputMap","MIDIPort",
  "MediaCapabilities","MediaDeviceInfo","MediaDevices","MediaElementAudioSourceNode",
  "MediaEncryptedEvent","MediaError","MediaKeyMessageEvent","MediaKeySession",
  "MediaKeyStatusMap","MediaKeySystemAccess","MediaKeys","MediaList","MediaMetadata",
  "MediaQueryList","MediaQueryListEvent","MediaRecorder","MediaSession","MediaSource",
  "MediaSourceHandle","MediaStream","MediaStreamAudioDestinationNode",
  "MediaStreamAudioSourceNode","MediaStreamEvent","MediaStreamTrack",
  "MediaStreamTrackEvent","MediaStreamTrackProcessor","MessageChannel","MessageEvent",
  "MessagePort","MimeType","MimeTypeArray","MouseEvent","MutationEvent",
  "MutationObserver","MutationRecord","NamedNodeMap","NavigateEvent","Navigation",
  "NavigationActivation","NavigationCurrentEntryChangeEvent","NavigationDestination",
  "NavigationHistoryEntry","NavigationTransition","Navigator","NetworkInformation",
  "Node","NodeFilter","NodeIterator","NodeList","Notification","OfflineAudioCompletionEvent",
  "OfflineAudioContext","OffscreenCanvas","OffscreenCanvasRenderingContext2D",
  "Option","OscillatorNode","OverconstrainedError","PageTransitionEvent","Path2D",
  "PaymentAddress","PaymentMethodChangeEvent","PaymentRequest","PaymentRequestUpdateEvent",
  "PaymentResponse","Performance","PerformanceElementTiming","PerformanceEntry",
  "PerformanceEventTiming","PerformanceLongAnimationFrameTiming",
  "PerformanceLongTaskTiming","PerformanceMark","PerformanceMeasure",
  "PerformanceNavigation","PerformanceNavigationTiming","PerformanceObserver",
  "PerformanceObserverEntryList","PerformancePaintTiming","PerformanceResourceTiming",
  "PerformanceScriptTiming","PerformanceServerTiming","PerformanceTiming",
  "PeriodicWave","PermissionStatus","Permissions","PictureInPictureEvent",
  "PictureInPictureWindow","Plugin","PluginArray","PointerEvent","PopStateEvent",
  "ProcessingInstruction","ProgressEvent","PromiseRejectionEvent","PublicKeyCredential",
  "PushManager","PushSubscription","PushSubscriptionOptions","RTCCertificate",
  "RTCDTMFSender","RTCDTMFToneChangeEvent","RTCDataChannel","RTCDataChannelEvent",
  "RTCDtlsTransport","RTCEncodedAudioFrame","RTCEncodedVideoFrame","RTCError",
  "RTCErrorEvent","RTCIceCandidate","RTCIceTransport","RTCPeerConnection",
  "RTCPeerConnectionIceErrorEvent","RTCPeerConnectionIceEvent","RTCRtpReceiver",
  "RTCRtpSender","RTCRtpTransceiver","RTCSctpTransport","RTCSessionDescription",
  "RTCStatsReport","RTCTrackEvent","RadioNodeList","Range","ReadableByteStreamController",
  "ReadableStream","ReadableStreamBYOBReader","ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController","ReadableStreamDefaultReader","RemotePlayback",
  "ReportingObserver","Request","ResizeObserver","ResizeObserverEntry","ResizeObserverSize",
  "Response","SVGAElement","SVGAngle","SVGAnimateElement","SVGAnimateMotionElement",
  "SVGAnimateTransformElement","SVGAnimatedAngle","SVGAnimatedBoolean",
  "SVGAnimatedEnumeration","SVGAnimatedInteger","SVGAnimatedLength",
  "SVGAnimatedLengthList","SVGAnimatedNumber","SVGAnimatedNumberList",
  "SVGAnimatedPreserveAspectRatio","SVGAnimatedRect","SVGAnimatedString",
  "SVGAnimatedTransformList","SVGAnimationElement","SVGCircleElement",
  "SVGClipPathElement","SVGComponentTransferFunctionElement","SVGDefsElement",
  "SVGDescElement","SVGElement","SVGEllipseElement","SVGFEBlendElement",
  "SVGFEColorMatrixElement","SVGFEComponentTransferElement","SVGFECompositeElement",
  "SVGFEConvolveMatrixElement","SVGFEDiffuseLightingElement","SVGFEDisplacementMapElement",
  "SVGFEDistantLightElement","SVGFEDropShadowElement","SVGFEFloodElement",
  "SVGFEFuncAElement","SVGFEFuncBElement","SVGFEFuncGElement","SVGFEFuncRElement",
  "SVGFEGaussianBlurElement","SVGFEImageElement","SVGFEMergeElement",
  "SVGFEMergeNodeElement","SVGFEMorphologyElement","SVGFEOffsetElement",
  "SVGFEPointLightElement","SVGFESpecularLightingElement","SVGFESpotLightElement",
  "SVGFETileElement","SVGFETurbulenceElement","SVGFilterElement","SVGForeignObjectElement",
  "SVGGElement","SVGGeometryElement","SVGGradientElement","SVGGraphicsElement",
  "SVGImageElement","SVGLength","SVGLengthList","SVGLineElement","SVGLinearGradientElement",
  "SVGMPathElement","SVGMarkerElement","SVGMaskElement","SVGMatrix","SVGMetadataElement",
  "SVGNumber","SVGNumberList","SVGPathElement","SVGPatternElement","SVGPoint",
  "SVGPointList","SVGPolygonElement","SVGPolylineElement","SVGPreserveAspectRatio",
  "SVGRadialGradientElement","SVGRect","SVGRectElement","SVGSVGElement","SVGScriptElement",
  "SVGSetElement","SVGStopElement","SVGStringList","SVGStyleElement","SVGSwitchElement",
  "SVGSymbolElement","SVGTSpanElement","SVGTextContentElement","SVGTextElement",
  "SVGTextPathElement","SVGTextPositioningElement","SVGTitleElement","SVGTransform",
  "SVGTransformList","SVGUseElement","SVGViewElement","Screen","ScreenOrientation",
  "ScriptProcessorNode","SecurityPolicyViolationEvent","Selection","ServiceWorker",
  "ServiceWorkerContainer","ServiceWorkerRegistration","ShadowRoot","SharedWorker",
  "SpeechSynthesis","SpeechSynthesisErrorEvent","SpeechSynthesisEvent",
  "SpeechSynthesisUtterance","SpeechSynthesisVoice","StaticRange","StereoPannerNode",
  "Storage","StorageEvent","StorageManager","StylePropertyMap","StylePropertyMapReadOnly",
  "StyleSheet","StyleSheetList","SubtleCrypto","Text","TextDecoder","TextDecoderStream",
  "TextEncoder","TextEncoderStream","TextEvent","TextMetrics","TextTrack","TextTrackCue",
  "TextTrackCueList","TextTrackList","TimeRanges","Touch","TouchEvent","TouchList",
  "TrackEvent","TransformStream","TransformStreamDefaultController","TransitionEvent",
  "TreeWalker","UIEvent","URL","URLPattern","URLSearchParams","UserActivation",
  "VTTCue","VideoColorSpace","VideoDecoder","VideoEncoder","VideoFrame","VideoPlaybackQuality",
  "VisualViewport","WaveShaperNode","WebGL2RenderingContext","WebGLActiveInfo",
  "WebGLBuffer","WebGLContextEvent","WebGLFramebuffer","WebGLProgram","WebGLQuery",
  "WebGLRenderbuffer","WebGLRenderingContext","WebGLSampler","WebGLShader",
  "WebGLShaderPrecisionFormat","WebGLSync","WebGLTexture","WebGLTransformFeedback",
  "WebGLUniformLocation","WebGLVertexArrayObject","WebSocket","WheelEvent","Window",
  "Worker","WritableStream","WritableStreamDefaultController","WritableStreamDefaultWriter",
  "XMLDocument","XMLHttpRequest","XMLHttpRequestEventTarget","XMLHttpRequestUpload",
  "XMLSerializer","XPathEvaluator","XPathExpression","XPathResult","XSLTProcessor",
  "console","devicePixelRatio","addEventListener","removeEventListener","dispatchEvent",
  "Infinity","NaN","undefined","globalThis","eval","isFinite","isNaN","parseFloat",
  "parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape",
  "unescape","Object","Function","Boolean","Symbol","Error","AggregateError","EvalError",
  "RangeError","ReferenceError","SyntaxError","TypeError","URIError","Number","BigInt",
  "Math","Date","String","RegExp","Array","Int8Array","Uint8Array","Uint8ClampedArray",
  "Int16Array","Uint16Array","Int32Array","Uint32Array","Float32Array","Float64Array",
  "BigInt64Array","BigUint64Array","Map","Set","WeakMap","WeakSet","WeakRef",
  "FinalizationRegistry","ArrayBuffer","SharedArrayBuffer","DataView","Atomics","JSON",
  "Promise","Generator","GeneratorFunction","AsyncFunction","AsyncGenerator",
  "AsyncGeneratorFunction","Reflect","Proxy","Intl","WebAssembly",
  "requestAnimationFrame","cancelAnimationFrame","requestIdleCallback","cancelIdleCallback",
  "queueMicrotask","createImageBitmap","structuredClone","fetch","alert","blur","confirm",
  "focus","getComputedStyle","getDefaultComputedStyle","getSelection","matchMedia",
  "moveBy","moveTo","open","print","prompt","resizeBy","resizeTo","scroll","scrollBy",
  "scrollTo","stop","webkitCancelAnimationFrame","webkitRequestAnimationFrame",
  "chrome","__CF$cv$params","__cfRLUnblockHandlers","__cfduid",
  "webpackChunk_N_E","__NEXT_DATA__","__next_f","next",
].sort();

// ─── 2. 代理 fetch（拦截 hcaptcha 请求）──────────────────────────────────────
let capturedToken = null;
let pendingChallengeSpec = null;

async function proxyFetch(url, options = {}) {
  const urlStr = typeof url === 'string' ? url : url.toString();
  const method = options.method || 'GET';
  const isHcaptchaEndpoint = urlStr.includes('hcaptcha-endpoint-prod');
  const isHcaptchaAssets = urlStr.includes('hcaptcha-assets-prod');

  if (isHcaptchaEndpoint) {
    console.log(`\n🌐 拦截 fetch: ${method} ${urlStr.slice(0, 80)}`);
  }

  // 构造 Node.js 请求
  const fetchUrl = new URL(urlStr);
  const reqHeaders = {
    ...(options.headers || {}),
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  };

  let bodyBuffer = null;
  if (options.body) {
    if (options.body instanceof Uint8Array || Buffer.isBuffer(options.body)) {
      bodyBuffer = Buffer.from(options.body);
    } else if (typeof options.body === 'string') {
      bodyBuffer = Buffer.from(options.body);
    } else if (options.body && options.body.constructor && options.body.constructor.name === 'Uint8Array') {
      bodyBuffer = Buffer.from(options.body);
    }
    if (bodyBuffer) {
      console.log(`   Body 长度: ${bodyBuffer.length} bytes, 首字节: 0x${bodyBuffer[0].toString(16)}`);
    }
  }

  return new Promise((resolve, reject) => {
    const nodeHttps = fetchUrl.protocol === 'https:' ? https : http;
    const req = nodeHttps.request({
      hostname: fetchUrl.hostname,
      port: fetchUrl.port || (fetchUrl.protocol === 'https:' ? 443 : 80),
      path: fetchUrl.pathname + fetchUrl.search,
      method,
      headers: {
        ...reqHeaders,
        ...(bodyBuffer ? { 'content-length': bodyBuffer.length } : {}),
      },
      agent: proxyAgent,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (isHcaptchaEndpoint) {
          console.log(`   响应状态: ${res.statusCode}, 长度: ${body.length}`);
          if (body[0] === 0x7b) {
            try {
              const json = JSON.parse(body.toString('utf-8'));
              console.log(`   响应 JSON:`, JSON.stringify(json));
              if (json.generated_pass_UUID) {
                capturedToken = json.generated_pass_UUID;
                console.log(`\n🎉🎉🎉 TOKEN 获取成功: ${capturedToken}`);
              }
              if (json.c) pendingChallengeSpec = json.c;
            } catch(e) {}
          }
        }

        // 构造 Response-like 对象
        const responseText = body.toString('utf-8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: new Map(Object.entries(res.headers)),
          text: () => Promise.resolve(responseText),
          json: () => Promise.resolve(JSON.parse(responseText)),
          arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
          body: body,
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

// ─── 3. 构造假 XHR（兼容旧版代码）────────────────────────────────────────────
class FakeXMLHttpRequest {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.response = null;
    this._headers = {};
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
  }
  open(method, url) {
    this._method = method;
    this._url = url;
  }
  setRequestHeader(k, v) {
    this._headers[k] = v;
  }
  send(body) {
    proxyFetch(this._url, {
      method: this._method,
      headers: this._headers,
      body: body,
    }).then(resp => {
      this.status = resp.status;
      this.readyState = 4;
      if (resp.body) {
        this.response = resp.body;
        this.responseText = resp.body.toString('utf-8');
      }
      if (this.onreadystatechange) this.onreadystatechange();
      if (this.onload) this.onload();
    }).catch(e => {
      if (this.onerror) this.onerror(e);
    });
  }
}

// ─── 4. 构造伪浏览器环境 ───────────────────────────────────────────────────────
function buildFakeWindow() {
  const fakeNav = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en'],
    platform: 'Win32',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    cookieEnabled: true,
    onLine: true,
    plugins: { length: 3, item: () => null, namedItem: () => null },
    mimeTypes: { length: 2 },
    vendor: 'Google Inc.',
    appName: 'Netscape',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    product: 'Gecko',
    productSub: '20030107',
    doNotTrack: null,
    credentials: { get: async () => null, create: async () => null, store: async () => null },
    permissions: { query: async () => ({ state: 'prompt' }) },
    webdriver: false,
    connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false },
    getBattery: () => Promise.resolve({ charging: true, level: 1.0 }),
    hasPrivateToken: undefined, // 没有 PST
  };

  const fakeScreen = {
    width: 1920, height: 1080,
    availWidth: 1920, availHeight: 1040,
    colorDepth: 24, pixelDepth: 24,
    orientation: { type: 'landscape-primary', angle: 0 },
  };

  const fakeDocument = {
    domain: HOST,
    referrer: `https://${HOST}/create`,
    cookie: '',
    location: { href: `https://${HOST}/create`, origin: `https://${HOST}`, hostname: HOST },
    hidden: false,
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      style: {},
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      addEventListener: () => {},
      getContext: () => ({
        fillRect: () => {},
        clearRect: () => {},
        getImageData: () => ({ data: new Uint8Array(4) }),
        putImageData: () => {},
        fillText: () => {},
        measureText: () => ({ width: 100 }),
        font: '',
        fillStyle: '',
        canvas: { width: 300, height: 150, toDataURL: () => 'data:image/png;base64,fake' },
        toDataURL: () => 'data:image/png;base64,fake',
      }),
      toDataURL: () => 'data:image/png;base64,fake',
    }),
    createTextNode: (t) => ({ nodeValue: t }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
      addEventListener: () => {},
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 1920, height: 1080 }),
    },
    head: { appendChild: () => {}, removeChild: () => {} },
    hasPrivateToken: undefined,
    featurePolicy: {
      allowsFeature: (f) => false,
    },
  };

  const fakeLocation = {
    href: `https://${HOST}/create`,
    origin: `https://${HOST}`,
    hostname: HOST,
    host: HOST,
    protocol: 'https:',
    pathname: '/create',
    search: '',
    hash: '',
  };

  // 伪造 performance
  const startTime = Date.now();
  const fakePerformance = {
    now: () => Date.now() - startTime,
    timeOrigin: startTime,
    memory: { usedJSHeapSize: 50*1024*1024, totalJSHeapSize: 100*1024*1024, jsHeapSizeLimit: 2*1024*1024*1024 },
    getEntriesByType: () => [],
    getEntriesByName: () => [],
    mark: () => {},
    measure: () => {},
    clearMarks: () => {},
    clearMeasures: () => {},
  };

  // 伪造 crypto（使用 Node.js 原生 crypto）
  const fakeCryptoSync = {
    getRandomValues: (arr) => { randomFillSync(arr); return arr; },
    subtle: webcrypto?.subtle || {},
    randomUUID: () => randomUUID(),
  };

  const fakeWindow = {
    // 核心对象
    window: null, // 后面自引用
    self: null,
    top: null,
    parent: null,
    frames: [],
    length: 0,

    // 浏览器 API
    navigator: fakeNav,
    screen: fakeScreen,
    document: fakeDocument,
    location: fakeLocation,
    history: { length: 5, back: () => {}, forward: () => {}, go: () => {}, pushState: () => {}, replaceState: () => {} },
    performance: fakePerformance,
    crypto: fakeCryptoSync,

    // 网络
    fetch: proxyFetch,
    XMLHttpRequest: FakeXMLHttpRequest,
    Headers: class Headers {
      constructor(init) { this._h = {}; if(init) Object.assign(this._h, init); }
      set(k,v) { this._h[k.toLowerCase()]=v; }
      get(k) { return this._h[k.toLowerCase()]; }
      has(k) { return k.toLowerCase() in this._h; }
      append(k,v) { this._h[k.toLowerCase()]=v; }
      entries() { return Object.entries(this._h)[Symbol.iterator](); }
    },
    Request: class Request {
      constructor(url, opts={}) { this.url=url; Object.assign(this, opts); }
    },
    Response: class Response {
      constructor(body, opts={}) { this.body=body; this.status=opts.status||200; this.ok=this.status<400; }
    },

    // 事件 / 计时器
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: clearTimeout,
    requestIdleCallback: (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1),
    cancelIdleCallback: clearTimeout,

    // 屏幕尺寸
    innerWidth: 1920,
    innerHeight: 1080,
    outerWidth: 1920,
    outerHeight: 1080,
    screenX: 0,
    screenY: 0,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    pageXOffset: 0,
    pageYOffset: 0,

    // 杂项
    isSecureContext: true,
    origin: `https://${HOST}`,
    name: '',
    closed: false,
    status: '',
    opener: null,
    frameElement: null,

    // 存储
    localStorage: new Map(),
    sessionStorage: new Map(),

    // 控制台
    console: console,

    // JS 全局 (继承自 global)
    undefined, Infinity, NaN,
    parseInt, parseFloat, isNaN, isFinite,
    decodeURI, decodeURIComponent, encodeURI, encodeURIComponent,
    Object, Function, Boolean, Symbol, Error, Array, Promise,
    Map, Set, WeakMap, WeakSet, Date, Math, JSON, RegExp, String, Number,
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array,
    ArrayBuffer, DataView, Proxy, Reflect, WeakRef,
    URL, URLSearchParams,
    TextEncoder, TextDecoder,
    FormData: class FormData { constructor() { this._d = {}; } append(k,v) { this._d[k]=v; } get(k) { return this._d[k]; } },
    AbortController, AbortSignal,
    structuredClone: structuredClone || ((x) => JSON.parse(JSON.stringify(x))),
    queueMicrotask,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    WebAssembly,

    // 设备运动（静态，无运动）
    DeviceMotionEvent: class DeviceMotionEvent {},
    DeviceOrientationEvent: class DeviceOrientationEvent {},

    // 用于 wdata 指纹：Object.keys(window) 返回我们控制的列表
    // 这个在下面通过 Proxy 实现
  };

  // 自引用
  fakeWindow.window = fakeWindow;
  fakeWindow.self = fakeWindow;
  fakeWindow.top = fakeWindow;
  fakeWindow.parent = fakeWindow;
  fakeWindow.globalThis = fakeWindow;

  return fakeWindow;
}

// ─── 5. 运行 bundle ────────────────────────────────────────────────────────────
async function main() {
  console.log('=== hCaptcha 补环境方案 ===\n');

  const fakeWindow = await buildFakeWindow();

  // 修复 crypto
  fakeWindow.crypto = {
    getRandomValues: (arr) => { randomFillSync(arr); return arr; },
    subtle: webcrypto?.subtle || {},
    randomUUID: () => randomUUID(),
  };

  // 读取 bundle JS
  const bundleJs = fs.readFileSync(path.join(__dirname, 'hcaptcha-bundle.js'), 'utf-8');
  console.log(`Bundle 大小: ${bundleJs.length} bytes`);

  // 用 vm.runInNewContext 运行，注入伪造环境
  const context = { ...fakeWindow };
  vm.createContext(context);

  // 拦截 Object.keys(window) — 通过给 context 添加一个 Proxy
  // 实际上 bundle 里调用的是 Object.keys(window)，window 就是全局对象本身
  // 在 vm 里 `window` 就是 context，所以我们在 context 上设置一个 getOwnPropertyNames 的 trap

  try {
    console.log('正在执行 bundle...');
    vm.runInContext(bundleJs, context, { timeout: 30000 });
    console.log('✅ Bundle 执行完毕，未抛出错误');
  } catch(e) {
    if (e.message && (e.message.includes('not a function') || e.message.includes('is not defined'))) {
      console.log('⚠️  Bundle 执行报错（可能正常）:', e.message.slice(0, 100));
    } else {
      console.log('Bundle 执行错误:', e.message.slice(0, 200));
    }
  }

  // 检查 bundle 是否暴露了 hcaptcha 全局对象
  const keys = Object.keys(context).filter(k => !Object.keys(fakeWindow).includes(k) || context[k] !== fakeWindow[k]);
  console.log('\nBundle 新增的全局变量:',
    keys.filter(k => typeof context[k] !== 'function' || k.length < 20).slice(0, 30)
  );

  // 等待异步请求
  console.log('\n等待 hCaptcha 内部请求...');
  await new Promise(r => setTimeout(r, 5000));

  if (capturedToken) {
    console.log('\n✅ 最终 Token:', capturedToken);
  } else {
    console.log('\n⚠️  未获取到 token，bundle 可能需要 DOM 交互');
    console.log('当前 pendingChallengeSpec:', pendingChallengeSpec);
  }
}

main().catch(e => {
  console.error('致命错误:', e.message);
  console.error(e.stack?.slice(0, 500));
  process.exit(1);
});
