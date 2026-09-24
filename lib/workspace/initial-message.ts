/** Defer the initial chat request until mount effects settle. React Strict Mode
 * replays effect cleanup, which makes useChat.stop() abort pending preparation.
 * Cancellation must happen before the message is marked as dispatched.
 */
export function scheduleInitialMessage(sent: { current: boolean }, dispatch: () => void) {
  const timer = setTimeout(() => {
    if (sent.current) return;
    sent.current = true;
    dispatch();
  }, 0);
  return () => clearTimeout(timer);
}
