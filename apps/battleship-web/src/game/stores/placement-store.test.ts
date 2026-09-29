import { SeededRandom } from "@outegro/battleship-engine";
import { describe, expect, it, vi } from "vitest";
import { server } from "../testing/fakes";
import type { MessageSender } from "../transport/game-socket";
import { PlacementStore } from "./placement-store";

function setup() {
  const sent: { type: string; payload: unknown }[] = [];
  let seq = 0;
  const sender: MessageSender = {
    send: vi.fn((type, payload) => {
      sent.push({ type, payload });
      return ++seq;
    }),
  };
  const store = new PlacementStore(sender, undefined, new SeededRandom(7));
  return { store, sent };
}

describe("PlacementStore", () => {
  it("starts with the classic fleet in the tray, longest selected", () => {
    const { store } = setup();
    expect(store.hand.map((slot) => slot.length)).toEqual([
      4, 3, 3, 2, 2, 2, 1, 1, 1, 1,
    ]);
    expect(store.selected?.length).toBe(4);
    expect(store.complete).toBe(false);
    expect(store.canSubmit).toBe(false);
  });

  it("places the selected ship and moves on to the next one", () => {
    const { store } = setup();
    expect(store.place({ x: 0, y: 0 })).toBe(true);
    expect(store.slotAt(3, 0)?.length).toBe(4);
    expect(store.selected?.length).toBe(3);
  });

  it("explains why a spot is not allowed", () => {
    const { store } = setup();
    store.place({ x: 0, y: 0 }); // 4-deck on A1–D1
    expect(store.place({ x: 8, y: 5 })).toBe(false);
    expect(store.issue).toBe("out_of_bounds");
    expect(store.place({ x: 2, y: 0 })).toBe(false);
    expect(store.issue).toBe("overlap");
    expect(store.place({ x: 4, y: 1 })).toBe(false);
    expect(store.issue).toBe("touching");
    expect(store.place({ x: 5, y: 2 })).toBe(true);
    expect(store.issue).toBeNull();
  });

  it("previews the selected ship under the pointer with its issue", () => {
    const { store } = setup();
    store.place({ x: 0, y: 0 });
    store.setPointer({ x: 1, y: 1 });
    expect(store.preview?.issue).toBe("touching");
    expect(store.preview?.cells).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    store.setPointer({ x: 8, y: 9 });
    expect(store.preview?.issue).toBe("out_of_bounds");
    // Off-board cells are not drawn.
    expect(store.preview?.cells).toHaveLength(2);
  });

  it("rotates a placed ship in place, unless it would break a rule", () => {
    const { store } = setup();
    store.place({ x: 0, y: 0 }); // 4-deck horizontal
    store.select(0);
    store.rotate();
    expect(store.slots[0]?.placement?.orientation).toBe("vertical");
    // Put a 3-deck to the right; turning the 4-deck back would touch it.
    store.select(1);
    expect(store.place({ x: 4, y: 0 })).toBe(true);
    store.select(0);
    store.rotate();
    expect(store.issue).toBe("touching");
    expect(store.slots[0]?.placement?.orientation).toBe("vertical");
  });

  it("taps: a cell places, the same ship again rotates, another ship is picked up", () => {
    const { store } = setup();
    store.activateCell(0, 0);
    expect(store.slotAt(0, 0)?.length).toBe(4);
    store.activateCell(0, 0); // nothing selected is the 4-deck → selects it
    expect(store.selected?.length).toBe(4);
    store.activateCell(1, 0); // the selected ship itself → rotate
    expect(store.slots[0]?.placement?.orientation).toBe("vertical");
    store.select(null);
    store.activateCell(0, 3);
    expect(store.selected?.id).toBe(0);
  });

  it("drags by the grabbed segment and drops where the pointer is", () => {
    const { store } = setup();
    store.beginDrag(1, 2); // 3-deck grabbed by its last segment
    store.setPointer({ x: 6, y: 4 });
    expect(store.preview?.placement).toMatchObject({ x: 4, y: 4 });
    expect(store.endDrag({ x: 6, y: 4 })).toBe(true);
    expect(store.slots[1]?.placement).toMatchObject({ x: 4, y: 4 });
    // Dropping outside the board leaves it where it was.
    store.beginDrag(1, 0);
    expect(store.endDrag(null)).toBe(false);
    expect(store.slots[1]?.placement).toMatchObject({ x: 4, y: 4 });
  });

  it("moves the keyboard cursor inside the board and places at it", () => {
    const { store } = setup();
    store.moveCursor(-1, -1);
    expect(store.cursor).toEqual({ x: 0, y: 0 });
    store.moveCursor(20, 3);
    expect(store.cursor).toEqual({ x: 9, y: 3 });
    store.setCursorActive(true);
    store.rotate(); // vertical 4-deck
    store.activateCell(9, 3);
    expect(store.slots[0]?.placement).toEqual({
      x: 9,
      y: 3,
      length: 4,
      orientation: "vertical",
    });
    store.removeAt(9, 5);
    expect(store.slots[0]?.placement).toBeNull();
    expect(store.selected?.id).toBe(0);
  });

  it("builds a valid random fleet and clears it", () => {
    const { store } = setup();
    store.randomize();
    expect(store.complete).toBe(true);
    expect(store.fleetError).toBeNull();
    expect(store.canSubmit).toBe(true);
    store.clear();
    expect(store.placed).toHaveLength(0);
    expect(store.selected?.length).toBe(4);
  });

  it("submits the fleet once and locks after the server confirms", () => {
    const { store, sent } = setup();
    store.randomize();
    expect(store.submit()).toBe(true);
    expect(sent[0]?.type).toBe("fleet.place");
    expect(
      (sent[0]?.payload as { ships: unknown[] } | undefined)?.ships,
    ).toHaveLength(10);
    expect(store.canSubmit).toBe(false);
    expect(store.submit()).toBe(false);

    store.handle(server("fleet.placed", { side: "you" }));
    expect(store.submitted).toBe(true);
    store.clear();
    expect(store.placed).toHaveLength(10);
  });

  it("shows the server's reason when it refuses the fleet", () => {
    const { store } = setup();
    store.randomize();
    store.submit();
    store.handle(server("error", { code: "touching", ref: 1 }));
    expect(store.serverError).toBe("touching");
    expect(store.submitted).toBe(false);
    expect(store.canSubmit).toBe(true);
  });
});
