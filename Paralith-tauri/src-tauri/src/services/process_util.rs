use std::ffi::OsStr;
use std::process::Command;

/// Build a `Command` for a background helper process (version probes, `taskkill`, `git`,
/// `wsl --list`). The app runs under `windows_subsystem = "windows"` in release builds, so a
/// spawned console program would otherwise allocate its own **visible** console window — the
/// "PARALITH opens external terminals" bug, which bursts into dozens of flashing windows when
/// several helpers run at once. `CREATE_NO_WINDOW` keeps every helper invisible.
pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}
