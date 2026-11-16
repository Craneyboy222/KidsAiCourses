import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_MS, UsageHeartbeat, useHeartbeat, type HeartbeatAnswer } from "@/components/course/use-heartbeat";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

let answer: HeartbeatAnswer = { allowed: true, minutesLeftToday: null };
const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }));
const sentSeconds = () => fetchMock.mock.calls.map((call) => (JSON.parse(String(call[1]?.body)) as { seconds: number }).seconds);

function Probe({ enabled, onAnswer }: { enabled: boolean; onAnswer: (answer: HeartbeatAnswer) => void }) {
  useHeartbeat(enabled, onAnswer);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  answer = { allowed: true, minutesLeftToday: null };
  fetchMock.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usage heartbeat", () => {
  it("reports about thirty seconds every thirty seconds while the tab is visible", async () => {
    const onAnswer = vi.fn();
    render(<Probe enabled onAnswer={onAnswer} />);
    await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/usage/heartbeat");
    expect(sentSeconds()).toEqual([30, 30]);
    expect(onAnswer).toHaveBeenCalledWith({ allowed: true, minutesLeftToday: null });
  });

  it("counts nothing while the tab is hidden", async () => {
    render(<Probe enabled onAnswer={() => {}} />);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    setVisibility("hidden");
    // Hidden for five minutes: only the ten visible seconds are ever reported.
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(sentSeconds()).toEqual([10]);
    setVisibility("visible");
    // The next report is twenty seconds after the tab came back, and that is all it claims.
    await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS));
    expect(sentSeconds()).toEqual([10, 20]);
  });

  it("sends nothing when it is switched off, and stops when unmounted", async () => {
    const off = render(<Probe enabled={false} onAnswer={() => {}} />);
    await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2));
    expect(fetchMock).not.toHaveBeenCalled();
    off.unmount();
    const on = render(<Probe enabled onAnswer={() => {}} />);
    on.unmount();
    await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never blocks anything when the report fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const onAnswer = vi.fn();
    render(<Probe enabled onAnswer={onAnswer} />);
    await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("on the learner pages, refreshes once when the cap arrives and then goes quiet", async () => {
    answer = { allowed: false, reason: "time_cap", message: "That's your learning time for today." };
    render(<UsageHeartbeat />);
    for (let beat = 0; beat < 3; beat += 1) await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
