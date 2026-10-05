import { fireEvent, render, screen, within } from "@testing-library/react";
import { DataTable } from "./data-table";
import { StatusPill } from "./status-pill";

describe("StatusPill", () => {
  it("never relies on colour alone: renders text with an icon", () => {
    const { container } = render(<StatusPill tone="grounded" />);
    expect(screen.getByText("Grounded")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("icon-only variant still exposes an accessible label", () => {
    render(<StatusPill tone="caution" label="Watch" iconOnly />);
    expect(screen.getByLabelText("Watch")).toBeInTheDocument();
  });
});

describe("DataTable", () => {
  const rows = [
    { tail: "AP-112", health: 44 },
    { tail: "AP-101", health: 90 },
    { tail: "AP-130", health: 61 },
  ];
  const cols = [
    { key: "tail", header: "Tail", cell: (r: (typeof rows)[0]) => r.tail, sortValue: (r: (typeof rows)[0]) => r.tail },
    { key: "health", header: "Health", cell: (r: (typeof rows)[0]) => r.health, sortValue: (r: (typeof rows)[0]) => r.health },
  ];
  const order = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

  it("applies the initial sort and toggles on header click", () => {
    render(<DataTable ariaLabel="t" rows={rows} columns={cols} rowKey={(r) => r.tail} initialSort={{ key: "health", dir: "asc" }} />);
    expect(order()).toEqual(["AP-112", "AP-130", "AP-101"]);
    fireEvent.click(screen.getByRole("button", { name: /Health/ }));
    expect(order()).toEqual(["AP-101", "AP-130", "AP-112"]);
    fireEvent.click(screen.getByRole("button", { name: /Tail/ }));
    expect(order()).toEqual(["AP-101", "AP-112", "AP-130"]);
  });

  it("rows are keyboard-activatable when clickable", () => {
    const onClick = vi.fn();
    render(<DataTable ariaLabel="t" rows={rows} columns={cols} rowKey={(r) => r.tail} onRowClick={onClick} />);
    fireEvent.keyDown(screen.getAllByRole("row")[1], { key: "Enter" });
    expect(onClick).toHaveBeenCalledWith(rows[0]);
  });
});
