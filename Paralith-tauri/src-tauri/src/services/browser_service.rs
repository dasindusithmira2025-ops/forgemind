use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use parking_lot::Mutex;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window};

use crate::errors::{AppError, AppResult};
use crate::models::browser::{BrowserBounds, BrowserEvent};

/// Event channel carrying [`BrowserEvent`]s to the owning window.
pub const BROWSER_EVENT: &str = "browser-event";

/// Only these schemes may ever be navigated to inside an embedded browser view. Everything else —
/// `file:`, `javascript:`, `data:`, `about:`, `blob:`, and privileged internal schemes — is refused
/// in the navigation hook so a page can never reach the filesystem or PARALITH's IPC.
const ALLOWED_SCHEMES: [&str; 2] = ["http", "https"];

/// A synthetic, non-resolving host used purely as a one-way page→Rust bridge for Inspect mode. The
/// injected script "navigates" here with a base64url payload; the navigation hook intercepts it,
/// forwards the payload as an event, and cancels the navigation so no request is ever made.
const INSPECT_HOST: &str = "paralith-inspect.invalid";
const MAX_INSPECT_PAYLOAD_LEN: usize = 16 * 1024;

#[derive(Clone)]
struct BrowserView {
    webview_label: String,
    window_label: String,
    current_url: Arc<Mutex<Option<String>>>,
    inspect_enabled: Arc<AtomicBool>,
}

/// Owns the embedded development-browser webviews, one per Workspace. Each view is a native child
/// webview added to the owning window, isolated from the PARALITH frontend: its label is granted no
/// capability, so even if a page tries to call `invoke`, the ACL denies every command.
#[derive(Clone)]
pub struct BrowserService {
    app: AppHandle,
    views: Arc<Mutex<HashMap<String, BrowserView>>>,
    operations: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

fn view_key(window_label: &str, workspace_id: &str) -> String {
    format!("{window_label}::{workspace_id}")
}

/// A diagnostics-safe copy of a URL: scheme + host + path only, so query strings (which can carry
/// tokens), fragments and embedded credentials never reach the log file.
fn redact_for_log(url: &Url) -> String {
    let mut copy = url.clone();
    copy.set_query(None);
    copy.set_fragment(None);
    let _ = copy.set_username("");
    let _ = copy.set_password(None);
    copy.to_string()
}

fn webview_label(window_label: &str, workspace_id: &str) -> String {
    format!("pfbrowser-{window_label}-{workspace_id}")
}

fn inspect_payload(url: &Url) -> Option<String> {
    let payload = url.as_str().rsplit('/').next().unwrap_or_default();
    (!payload.is_empty() && payload.len() <= MAX_INSPECT_PAYLOAD_LEN).then(|| payload.to_string())
}

fn no_view() -> AppError {
    AppError::new(
        "browser_view_missing",
        "The embedded browser view is not open.",
        true,
    )
    .layer("browser")
}

fn build_failed(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "browser_build_failed",
        "The embedded browser could not be created.",
        true,
    )
    .detail(error.to_string())
    .layer("browser")
}

impl BrowserService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            views: Arc::new(Mutex::new(HashMap::new())),
            operations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn operation_lock(&self, key: &str) -> Arc<Mutex<()>> {
        self.operations
            .lock()
            .entry(key.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Validate a navigation target against the scheme allow-list, mirroring the frontend guard.
    fn parse_navigable(url: &str) -> AppResult<Url> {
        let parsed = Url::parse(url).map_err(|error| {
            AppError::new("browser_invalid_url", "That address is not valid.", true)
                .detail(error.to_string())
                .layer("browser")
        })?;
        if !ALLOWED_SCHEMES.contains(&parsed.scheme()) {
            return Err(AppError::new(
                "browser_blocked_scheme",
                "This address uses a scheme that is blocked in the embedded browser.",
                true,
            )
            .entity(parsed.scheme())
            .layer("browser"));
        }
        Ok(parsed)
    }

    /// Open (or reveal + reposition) the Workspace's browser view over the given bounds. Reuses an
    /// existing view so switching tools never recreates the webview or loses page state. When `url`
    /// is provided the view is created pointing directly at it (avoiding an about:blank → navigate
    /// race), or an existing view is navigated to it when it differs from the current page.
    pub fn open(
        &self,
        window: &Window,
        workspace_id: &str,
        bounds: BrowserBounds,
        url: Option<&str>,
    ) -> AppResult<()> {
        // Validate any requested URL up front so a blocked scheme never even creates a view.
        let target = match url {
            Some(raw) => Some(Self::parse_navigable(raw)?),
            None => None,
        };

        let key = view_key(window.label(), workspace_id);
        let operation_lock = self.operation_lock(&key);
        let _operation = operation_lock.lock();
        log::info!(
            "browser open: window={} workspace={} bounds=({}, {}, {}x{}) scale={:?} url={}",
            window.label(),
            workspace_id,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            window.scale_factor(),
            target
                .as_ref()
                .map(redact_for_log)
                .unwrap_or_else(|| "<none>".into())
        );
        let existing = self.views.lock().get(&key).cloned();
        if let Some(view) = existing {
            if let Some(webview) = self.app.get_webview(&view.webview_label) {
                log::info!("browser open: reusing existing view {}", view.webview_label);
                webview
                    .set_position(LogicalPosition::new(bounds.x, bounds.y))
                    .map_err(build_failed)?;
                webview
                    .set_size(LogicalSize::new(bounds.width, bounds.height))
                    .map_err(build_failed)?;
                if let Some(target) = target {
                    let mut current = view.current_url.lock();
                    if current.as_deref() != Some(target.as_str()) {
                        webview.navigate(target.clone()).map_err(build_failed)?;
                        *current = Some(target.to_string());
                    }
                }
                return Ok(());
            }
            // Stale entry (window/webview gone); fall through and rebuild.
            self.views.lock().remove(&key);
        }

        let label = webview_label(window.label(), workspace_id);
        let app = self.app.clone();
        let owner = window.label().to_string();
        let ws = workspace_id.to_string();

        let initial = match &target {
            Some(target) => WebviewUrl::External(target.clone()),
            None => WebviewUrl::External(Url::parse("about:blank").map_err(build_failed)?),
        };

        // Security + inspect bridge: refuse anything outside the allow-list and intercept the inspect
        // sentinel host without ever performing the navigation.
        let nav_app = app.clone();
        let nav_owner = owner.clone();
        let nav_ws = ws.clone();
        let nav_views = self.views.clone();
        let nav_key = key.clone();
        let load_views = self.views.clone();
        let load_key = key.clone();
        let builder = WebviewBuilder::new(&label, initial)
            // No PARALITH init scripts and its own isolated data are the default for an External URL;
            // the page shares nothing with the main frontend's origin.
            .on_navigation(move |url| {
                let scheme = url.scheme().to_ascii_lowercase();
                // Allow the webview's own internal blank/initialization loads through untouched;
                // blocking them here can wedge the webview before any real page is shown.
                if scheme == "about" {
                    return url.as_str() == "about:blank";
                }
                if ALLOWED_SCHEMES.contains(&scheme.as_str()) {
                    if url.host_str() == Some(INSPECT_HOST) {
                        let view = nav_views.lock().get(&nav_key).cloned();
                        let was_enabled = view
                            .as_ref()
                            .is_some_and(|view| view.inspect_enabled.swap(false, Ordering::AcqRel));
                        if was_enabled {
                            if let Some(payload) = inspect_payload(url) {
                                let _ = nav_app.emit_to(
                                    nav_owner.as_str(),
                                    BROWSER_EVENT,
                                    BrowserEvent::InspectSelected {
                                        workspace_id: nav_ws.clone(),
                                        payload,
                                    },
                                );
                            } else {
                                log::warn!(
                                    "browser inspect payload rejected: window={} workspace={}",
                                    nav_owner,
                                    nav_ws
                                );
                            }
                        }
                        return false;
                    }
                    return true;
                }
                let _ = nav_app.emit_to(
                    nav_owner.as_str(),
                    BROWSER_EVENT,
                    BrowserEvent::NavBlocked {
                        workspace_id: nav_ws.clone(),
                        url: url.to_string(),
                        scheme,
                    },
                );
                false
            })
            .on_page_load(move |webview, payload| {
                let url = payload.url().to_string();
                if url.contains(INSPECT_HOST) {
                    return;
                }
                // Track where the page actually is (redirects, in-page link clicks), not only what
                // was last commanded — otherwise the frontend syncing its address bar to the real
                // URL would make the next `open` issue a redundant re-navigation (a reload).
                if url != "about:blank" {
                    if let Some(view) = load_views.lock().get(&load_key).cloned() {
                        *view.current_url.lock() = Some(url.clone());
                        view.inspect_enabled.store(false, Ordering::Release);
                    }
                }
                let event = match payload.event() {
                    tauri::webview::PageLoadEvent::Started => BrowserEvent::LoadStarted {
                        workspace_id: ws.clone(),
                        url,
                    },
                    tauri::webview::PageLoadEvent::Finished => BrowserEvent::LoadFinished {
                        workspace_id: ws.clone(),
                        url,
                    },
                };
                let _ = webview
                    .app_handle()
                    .emit_to(owner.as_str(), BROWSER_EVENT, event);
            });

        let title_app = app.clone();
        let title_owner = window.label().to_string();
        let title_ws = workspace_id.to_string();
        let builder = builder.on_document_title_changed(move |_webview, title| {
            let _ = title_app.emit_to(
                title_owner.as_str(),
                BROWSER_EVENT,
                BrowserEvent::TitleChanged {
                    workspace_id: title_ws.clone(),
                    title,
                },
            );
        });

        // Register ownership before creating the child: WebView can synchronously deliver initial
        // navigation/page-load callbacks from `add_child`, and those callbacks must see the view.
        self.views.lock().insert(
            key.clone(),
            BrowserView {
                webview_label: label.clone(),
                window_label: window.label().to_string(),
                current_url: Arc::new(Mutex::new(target.map(|url| url.to_string()))),
                inspect_enabled: Arc::new(AtomicBool::new(false)),
            },
        );
        let created = match window.add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        ) {
            Ok(created) => created,
            Err(error) => {
                self.views.lock().remove(&key);
                log::error!("browser open: add_child failed for {label}: {error}");
                return Err(build_failed(error));
            }
        };
        log::info!(
            "browser open: created {} pos={:?} size={:?}",
            label,
            created.position(),
            created.size()
        );
        created.hide().map_err(build_failed)?;

        Ok(())
    }

    fn with_webview<T>(
        &self,
        window_label: &str,
        workspace_id: &str,
        action: impl FnOnce(tauri::webview::Webview, &BrowserView) -> AppResult<T>,
    ) -> AppResult<T> {
        let key = view_key(window_label, workspace_id);
        let view = self.views.lock().get(&key).cloned().ok_or_else(no_view)?;
        let webview = self
            .app
            .get_webview(&view.webview_label)
            .ok_or_else(no_view)?;
        action(webview, &view)
    }

    pub fn navigate(&self, window_label: &str, workspace_id: &str, url: &str) -> AppResult<()> {
        let parsed = Self::parse_navigable(url)?;
        self.with_webview(window_label, workspace_id, |webview, view| {
            webview.navigate(parsed.clone()).map_err(build_failed)?;
            *view.current_url.lock() = Some(parsed.to_string());
            Ok(())
        })
    }

    pub fn reload(&self, window_label: &str, workspace_id: &str) -> AppResult<()> {
        self.with_webview(window_label, workspace_id, |webview, _view| {
            webview
                .eval("try{location.reload()}catch(e){}")
                .map_err(build_failed)
        })
    }

    pub fn stop(&self, window_label: &str, workspace_id: &str) -> AppResult<()> {
        self.with_webview(window_label, workspace_id, |webview, _view| {
            webview
                .eval("try{window.stop()}catch(e){}")
                .map_err(build_failed)
        })
    }

    pub fn set_bounds(
        &self,
        window_label: &str,
        workspace_id: &str,
        bounds: BrowserBounds,
    ) -> AppResult<()> {
        self.with_webview(window_label, workspace_id, |webview, _view| {
            webview
                .set_position(LogicalPosition::new(bounds.x, bounds.y))
                .map_err(build_failed)?;
            webview
                .set_size(LogicalSize::new(bounds.width, bounds.height))
                .map_err(build_failed)
        })
    }

    pub fn set_visible(
        &self,
        window_label: &str,
        workspace_id: &str,
        visible: bool,
    ) -> AppResult<()> {
        self.with_webview(window_label, workspace_id, |webview, _view| {
            if visible {
                webview.show().map_err(build_failed)
            } else {
                webview.hide().map_err(build_failed)
            }
        })
    }

    pub fn set_zoom(&self, window_label: &str, workspace_id: &str, factor: f64) -> AppResult<()> {
        let clamped = factor.clamp(0.25, 5.0);
        self.with_webview(window_label, workspace_id, |webview, _view| {
            webview.set_zoom(clamped).map_err(build_failed)
        })
    }

    pub fn set_inspect(
        &self,
        window_label: &str,
        workspace_id: &str,
        enable: bool,
    ) -> AppResult<()> {
        let script = if enable {
            INSPECT_ENABLE_JS
        } else {
            INSPECT_DISABLE_JS
        };
        self.with_webview(window_label, workspace_id, |webview, view| {
            webview.eval(script).map_err(build_failed)?;
            view.inspect_enabled.store(enable, Ordering::Release);
            Ok(())
        })
    }

    pub fn close(&self, window_label: &str, workspace_id: &str) -> AppResult<()> {
        let key = view_key(window_label, workspace_id);
        let operation_lock = self.operation_lock(&key);
        let _operation = operation_lock.lock();
        let removed = self.views.lock().remove(&key);
        if let Some(view) = removed {
            if let Some(webview) = self.app.get_webview(&view.webview_label) {
                let _ = webview.close();
            }
        }
        Ok(())
    }

    /// Tear down every view owned by a window that is going away, so no orphan webviews leak.
    pub fn close_for_window(&self, window_label: &str) {
        let removed: Vec<BrowserView> = {
            let mut guard = self.views.lock();
            let keys: Vec<String> = guard
                .iter()
                .filter(|(_, view)| view.window_label == window_label)
                .map(|(key, _)| key.clone())
                .collect();
            keys.into_iter()
                .filter_map(|key| guard.remove(&key))
                .collect()
        };
        for view in removed {
            if let Some(webview) = self.app.get_webview(&view.webview_label) {
                let _ = webview.close();
            }
        }
    }
}

/// Injected into the (untrusted) page to enter element-selection mode. It highlights the hovered
/// element and, on click, sends a bounded, value-free capture back through the sentinel-host bridge.
/// Values, password fields, cookies and storage are never read.
const INSPECT_ENABLE_JS: &str = r#"(function(){
  if (window.__paralithInspect) return;
  var host = 'http://paralith-inspect.invalid/';
  function b64url(s){ try { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); } catch(e){ return ''; } }
  function selectorFor(el){
    if(!el||el.nodeType!==1) return '';
    if(el.id) return el.tagName.toLowerCase()+'#'+el.id;
    var parts=[]; var node=el; var depth=0;
    while(node && node.nodeType===1 && depth<5){
      var part=node.tagName.toLowerCase();
      if(node.id){ parts.unshift(part+'#'+node.id); break; }
      var cls=(node.className&&node.className.toString?node.className.toString().trim().split(/\s+/).slice(0,2):[]);
      if(cls.length&&cls[0]) part+='.'+cls.join('.');
      var parent=node.parentElement;
      if(parent){ var same=Array.prototype.filter.call(parent.children,function(c){return c.tagName===node.tagName;}); if(same.length>1){ part+=':nth-of-type('+(same.indexOf(node)+1)+')'; } }
      parts.unshift(part); node=parent; depth++;
    }
    return parts.join(' > ').slice(0,300);
  }
  function capture(el){
    var attrs={}; if(el.attributes){ for(var i=0;i<el.attributes.length && i<30;i++){ var a=el.attributes[i]; if(/^value$|pass|secret|token|key|auth|cookie|session/i.test(a.name)) continue; attrs[a.name]=String(a.value).slice(0,200); } }
    var cs=null; try{ cs=getComputedStyle(el); }catch(e){}
    var layout={}; if(cs){ ['display','position','width','height','margin','padding','color','backgroundColor','fontSize'].forEach(function(k){ layout[k]=cs[k]; }); }
    var r=el.getBoundingClientRect();
    var html=''; try{ html=el.outerHTML.slice(0,2000); }catch(e){}
    return { tag: el.tagName, id: el.id||undefined, classNames: (el.className&&el.className.toString?el.className.toString().trim().split(/\s+/).filter(Boolean).slice(0,40):[]), attributes: attrs, text: (el.innerText||'').trim().slice(0,500), accessibleName: (el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('alt'))||'').slice(0,200), selector: selectorFor(el), rect:{x:r.x,y:r.y,width:r.width,height:r.height}, layout: layout, domExcerpt: html };
  }
  var box=document.createElement('div');
  box.setAttribute('data-paralith-inspect','1');
  box.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7c5cff;background:rgba(124,92,255,.12);border-radius:2px;transition:all .03s;top:0;left:0;width:0;height:0;';
  document.documentElement.appendChild(box);
  function move(e){ var el=e.target; if(!el||el===box) return; var r=el.getBoundingClientRect(); box.style.top=r.top+'px'; box.style.left=r.left+'px'; box.style.width=r.width+'px'; box.style.height=r.height+'px'; }
  function click(e){ e.preventDefault(); e.stopPropagation(); var data=capture(e.target); teardown(); location.href=host+b64url(JSON.stringify(data)); }
  function key(e){ if(e.key==='Escape'){ teardown(); } }
  function teardown(){ document.removeEventListener('mousemove',move,true); document.removeEventListener('click',click,true); document.removeEventListener('keydown',key,true); if(box&&box.parentNode) box.parentNode.removeChild(box); window.__paralithInspect=false; }
  window.__paralithInspectTeardown=teardown;
  document.addEventListener('mousemove',move,true);
  document.addEventListener('click',click,true);
  document.addEventListener('keydown',key,true);
  window.__paralithInspect=true;
})();"#;

const INSPECT_DISABLE_JS: &str =
    "(function(){ if(window.__paralithInspectTeardown){ try{ window.__paralithInspectTeardown(); }catch(e){} } })();";

#[cfg(test)]
mod tests {
    use super::{inspect_payload, webview_label, MAX_INSPECT_PAYLOAD_LEN};
    use tauri::Url;

    #[test]
    fn browser_labels_are_unique_per_owner_window() {
        assert_ne!(
            webview_label("main", "workspace-1"),
            webview_label("workspace-window", "workspace-1")
        );
    }

    #[test]
    fn inspect_bridge_rejects_empty_and_oversized_payloads() {
        assert!(
            inspect_payload(&Url::parse("http://paralith-inspect.invalid/").unwrap()).is_none()
        );
        let oversized = "a".repeat(MAX_INSPECT_PAYLOAD_LEN + 1);
        let url = Url::parse(&format!("http://paralith-inspect.invalid/{oversized}")).unwrap();
        assert!(inspect_payload(&url).is_none());
    }
}
