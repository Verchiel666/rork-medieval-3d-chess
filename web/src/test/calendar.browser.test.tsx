import { render } from "vitest-browser-react";

import { Calendar } from "@/components/ui/calendar";

test("渲染出带导航控件的月份网格", async () => {
  // 固定月份，让日历网格在多次测试运行间保持确定性。
  const screen = await render(<Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} />);

  await expect.element(screen.getByRole("grid")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: /previous/i })).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  expect(screen.getByRole("gridcell").all().length).toBeGreaterThan(27);
});
