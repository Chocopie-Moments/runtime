//! macOS resource probe. Timings exclude display pacing, host copies and composition.
#[cfg(target_os = "macos")]
mod probe {
    use choco_core::player::Player;
    use choco_native::{render::Renderer, scene::Document};
    use serde_json::{Value, json};
    use std::{
        env,
        io::{self, Read},
        mem::MaybeUninit,
        time::Instant,
    };

    fn cpu_ms() -> Result<f64, String> {
        let mut usage = MaybeUninit::<libc::rusage>::uninit();
        // getrusage initializes the complete structure on success.
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error().to_string());
        }
        let usage = unsafe { usage.assume_init() };
        Ok([usage.ru_utime, usage.ru_stime]
            .iter()
            .map(|t| t.tv_sec as f64 * 1000. + t.tv_usec as f64 / 1000.)
            .sum())
    }

    fn rss() -> Result<u64, String> {
        let mut info = MaybeUninit::<libc::mach_task_basic_info>::uninit();
        let mut count = libc::MACH_TASK_BASIC_INFO_COUNT;
        // task_info writes exactly MACH_TASK_BASIC_INFO_COUNT integer_t values.
        #[allow(deprecated)]
        let status = unsafe {
            libc::task_info(
                libc::mach_task_self(),
                libc::MACH_TASK_BASIC_INFO,
                info.as_mut_ptr().cast(),
                &mut count,
            )
        };
        if status != libc::KERN_SUCCESS || count != libc::MACH_TASK_BASIC_INFO_COUNT {
            return Err(format!("task_info failed: {status}, count {count}"));
        }
        Ok(unsafe { info.assume_init() }.resident_size)
    }

    fn mount(document: &Document, size: u32) -> Result<(Player, Renderer), String> {
        let mut player = Player::new(document.score.clone(), &document.rig, false)?;
        player.trigger("enter")?;
        let renderer = Renderer::new(document, &player, size, size)?;
        Ok((player, renderer))
    }

    fn sample(
        player: &mut Player,
        renderer: &mut Renderer,
        label: &str,
        count: usize,
    ) -> Result<Value, String> {
        let mut times = Vec::with_capacity(count);
        let mut changed = 0;
        let cpu_start = cpu_ms()?;
        for _ in 0..count {
            let start = Instant::now();
            player.advance(1. / 60.)?;
            changed += usize::from(renderer.render(player)?.changed);
            times.push(start.elapsed().as_secs_f64() * 1000.);
        }
        let cpu = cpu_ms()? - cpu_start;
        times.sort_by(f64::total_cmp);
        Ok(json!({"phase": label, "frames": count, "changed": changed,
            "cpuMs": cpu, "cpuMsPerFrame": cpu / count as f64,
            "oneCorePercentAt60Fps": cpu / count as f64 * 6.,
            "p50Ms": times[count / 2], "p95Ms": times[count * 95 / 100],
            "rssBytes": rss()?, "retainedPaints": renderer.retained_paints()}))
    }

    pub fn run() -> Result<(), String> {
        let size = env::args()
            .nth(1)
            .unwrap_or_else(|| "320".into())
            .parse()
            .map_err(|_| "Invalid size")?;
        let mut bytes = Vec::new();
        io::stdin()
            .take(2_097_153)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let baseline = rss()?;
        let start = Instant::now();
        let document = Document::read(&bytes)?;
        let (mut player, mut renderer) = mount(&document, size)?;
        renderer.render(&player)?;
        let load = start.elapsed().as_secs_f64() * 1000.;
        let mut phases = vec![sample(&mut player, &mut renderer, "enter", 240)?];
        for trigger in ["hover", "click"] {
            player.trigger(trigger)?;
            phases.push(sample(&mut player, &mut renderer, trigger, 240)?);
        }
        for state in document
            .score
            .states
            .iter()
            .flat_map(|states| states.keys())
        {
            player.set_state(Some(state), true)?;
            phases.push(sample(&mut player, &mut renderer, state, 240)?);
        }
        player.set_paused(true);
        phases.push(sample(&mut player, &mut renderer, "paused", 240)?);
        drop(renderer);
        drop(player);
        let mut lifecycle = Vec::new();
        // Warm allocator retention is distinguished from continued growth after warmup.
        for iteration in 1..=100 {
            let document = Document::read(&bytes)?;
            let (mut player, mut renderer) = mount(&document, size)?;
            player.advance(0.6)?;
            renderer.render(&player)?;
            renderer.resize(size / 2, size / 2)?;
            player.trigger("click")?;
            player.advance(0.3)?;
            renderer.render(&player)?;
            drop(renderer);
            drop(player);
            drop(document);
            if iteration % 10 == 0 {
                lifecycle.push(json!({"mounts": iteration, "rssBytes": rss()?}));
            }
        }
        // Multiple retained instances on the production renderer's owning thread.
        let mut instances = (0..8)
            .map(|_| mount(&document, size))
            .collect::<Result<Vec<_>, _>>()?;
        let multi_cpu = cpu_ms()?;
        let mut multi_times = Vec::with_capacity(240);
        for _ in 0..240 {
            let start = Instant::now();
            for (player, renderer) in &mut instances {
                player.advance(1. / 60.)?;
                renderer.render(player)?;
            }
            multi_times.push(start.elapsed().as_secs_f64() * 1000.);
        }
        let multi_cpu = cpu_ms()? - multi_cpu;
        multi_times.sort_by(f64::total_cmp);
        let multi = json!({"instances": 8, "frames": 240, "cpuMs": multi_cpu,
            "oneCorePercentAt60Fps": multi_cpu / 240. * 6.,
            "p95Ms": multi_times[228], "rssBytes": rss()?});
        drop(instances);
        println!(
            "{}",
            json!({"width": size, "assetBytes": bytes.len(), "baselineRssBytes": baseline,
            "loadToFirstFrameMs": load, "phases": phases, "lifecycle": lifecycle,
            "eightInstances": multi, "afterDestroyRssBytes": rss()?})
        );
        Ok(())
    }
}

fn main() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return probe::run();
    #[cfg(not(target_os = "macos"))]
    Err("This resource probe uses macOS task_info and getrusage".into())
}
