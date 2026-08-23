/// 数据库所在目录：exe 同目录（class.db 与裸 exe 作伴，便于 U 盘携带/备份）
#[tauri::command]
fn get_data_dir() -> String {
  std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|d| d.to_string_lossy().into_owned()))
    .unwrap_or_else(|| ".".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .invoke_handler(tauri::generate_handler![get_data_dir])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
