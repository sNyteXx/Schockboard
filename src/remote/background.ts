import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'

import { SyncEngine } from '@/remote/sync-engine'

export const REMOTE_SYNC_TASK = 'schockboard-remote-sync'

// Must run at module scope so Android can start the task headless.
TaskManager.defineTask(REMOTE_SYNC_TASK, async () => {
  const outcome = await SyncEngine.syncNow()
  return outcome.status === 'error' ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success
})

/** Registers (or removes) the OS-scheduled sync task. */
export async function syncBackgroundRegistration(paired: boolean) {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(REMOTE_SYNC_TASK)
    if (paired && !registered) {
      // Android WorkManager does not run more often than every 15 minutes.
      await BackgroundTask.registerTaskAsync(REMOTE_SYNC_TASK, { minimumInterval: 15 })
    } else if (!paired && registered) {
      await BackgroundTask.unregisterTaskAsync(REMOTE_SYNC_TASK)
    }
  } catch {
    // Background execution unavailable (e.g. restricted by the OS): the
    // foreground triggers still keep the server current.
  }
}
