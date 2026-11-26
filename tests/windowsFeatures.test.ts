import assert from "node:assert/strict";
import test from "node:test";

import {
  copyNodeToSystemClipboard,
  dataUrlToPngFile,
  readDesktopClipboardScreenshot,
} from "../src/canvas/clipboardSystem.ts";
import {
  buildStoryboardCanvasFragment,
  createDefaultStoryboardRows,
} from "../src/canvas/storyboardSheet.ts";
import {
  WORKFLOW_TEMPLATES,
  buildWorkflowTemplateFragment,
} from "../src/canvas/workflowTemplates.ts";
import { desktopExportStarted, desktopNotify, desktopTaskProgress } from "../src/desktop.ts";
import { translate } from "../src/i18n/messages.ts";

test("all 4 workflow templates build valid non-overlapping fragments in zh-CN and en-US", () => {
  assert.equal(WORKFLOW_TEMPLATES.length, 4);
  for (const locale of ["zh-CN", "en-US"] as const) {
    const t = ((key, params) => translate(locale, key, params)) as Parameters<
      typeof buildWorkflowTemplateFragment
    >[1];
    for (const template of WORKFLOW_TEMPLATES) {
      const fragment = buildWorkflowTemplateFragment(template, t);
      assert.equal(fragment.nodes.length, template.nodes.length);
      assert.equal(fragment.edges.length, template.edges.length);

      const ids = new Set(fragment.nodes.map((node) => node.id));
      assert.equal(ids.size, fragment.nodes.length, "unique node ids");

      const nodeById = new Map(fragment.nodes.map((node) => [node.id, node]));
      for (const edge of fragment.edges) {
        assert.ok(ids.has(edge.source), `edge source exists in ${template.id}`);
        assert.ok(ids.has(edge.target), `edge target exists in ${template.id}`);
        assert.notEqual(edge.source, edge.target);
        assert.equal(
          nodeById.get(edge.source)?.type,
          "text",
          `template ${template.id} edge sources must be populated text nodes`,
        );
      }

      for (const node of fragment.nodes) {
        assert.ok(node.data.title.length > 0);
        if (node.type === "text") {
          assert.ok((node.data.text ?? "").length > 0);
        } else {
          assert.ok(node.data.prompt.length > 0);
        }
      }
    }
  }
});

test("copyNodeToSystemClipboard handles desktop text copy and video fallback", async () => {
  const prevWindow = (globalThis as { window?: unknown }).window;
  const written: string[] = [];
  (globalThis as { window?: unknown }).window = {
    opendirectorDesktop: {
      clipboardWriteText: async (text: string) => {
        written.push(text);
        return true;
      },
    },
  };
  try {
    const textOutcome = await copyNodeToSystemClipboard([
      {
        id: "n1",
        type: "text",
        position: { x: 0, y: 0 },
        width: 240,
        height: 120,
        data: { kind: "text", title: "Script", text: "Line 1\nLine 2", prompt: "" },
      },
    ]);
    assert.deepEqual(textOutcome, { status: "copied", kind: "text" });
    assert.deepEqual(written, ["Line 1\nLine 2"]);

    const videoOutcome = await copyNodeToSystemClipboard([
      {
        id: "n2",
        type: "video",
        position: { x: 0, y: 0 },
        width: 240,
        height: 120,
        data: { kind: "video", title: "Clip", src: "/api/creation/assets/v1", prompt: "" },
      },
    ]);
    assert.deepEqual(videoOutcome, { status: "fallback", kind: "video" });
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});

test("desktop bridge lifecycle calls setExporting, taskbar progress, and notify", () => {
  const prevWindow = (globalThis as { window?: unknown }).window;
  const events: unknown[] = [];
  (globalThis as { window?: unknown }).window = {
    opendirectorDesktop: {
      registerSession: () => {},
      setLocale: () => {},
      setExporting: (active: boolean) => events.push(["exporting", active]),
      setTaskProgress: (v: number, mode?: string) => events.push(["progress", v, mode]),
      notify: (title: string, body: string) => events.push(["notify", title, body]),
    },
  };
  try {
    const finish = desktopExportStarted();
    desktopTaskProgress(0.5, "normal");
    desktopNotify("Done", "Exported MP4");
    finish();
    assert.deepEqual(events, [
      ["exporting", true],
      ["progress", 0.02, "normal"],
      ["progress", 0.5, "normal"],
      ["notify", "Done", "Exported MP4"],
      ["exporting", false],
      ["progress", -1, "none"],
    ]);
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});

test("Director Storyboard Sheet scaffolds master script, connected shots, and assembly timeline in zh-CN and en-US", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const t = ((key, params) => translate(locale, key, params)) as Parameters<
      typeof createDefaultStoryboardRows
    >[0];
    const rows = createDefaultStoryboardRows(t);
    assert.equal(rows.length, 4);
    const fragment = buildStoryboardCanvasFragment(rows, t);
    // 1 master script + 4 shot nodes + 1 timeline node = 6 nodes
    assert.equal(fragment.nodes.length, 6);
    assert.equal(fragment.edges.length, 4);
    assert.equal(fragment.nodes[0].type, "text");
    assert.equal(fragment.nodes[fragment.nodes.length - 1].type, "timeline");
    const masterId = fragment.nodes[0].id;
    for (const edge of fragment.edges) {
      assert.equal(edge.source, masterId, "only populated master text connects downstream");
    }
  }
});

test("system clipboard screenshot reader converts desktop PNG dataUrl to File", async () => {
  const sample =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const file = dataUrlToPngFile(sample, "shot.png");
  assert.ok(file);
  assert.equal(file.name, "shot.png");
  assert.equal(file.type, "image/png");
  assert.ok(file.size > 0);

  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    opendirectorDesktop: {
      clipboardRead: async () => ({
        formats: ["image/png"],
        hasImage: true,
        imageDataUrl: sample,
        text: "",
      }),
    },
  };
  try {
    const pasted = await readDesktopClipboardScreenshot();
    assert.ok(pasted);
    assert.equal(pasted.type, "image/png");
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});
