use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager,
};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    // macOS標準の終了項目はOSへ直接終了を要求するため、保存を待つ項目に置き換えます。
    menu.remove_at(0)?;
    let app_menu = Submenu::with_items(
        app,
        "ledad",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "save-and-quit",
                "ledadを終了",
                true,
                Some("CmdOrCtrl+Q"),
            )?,
        ],
    )?;
    menu.prepend(&app_menu)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "save-and-quit" {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
    });
    Ok(())
}
