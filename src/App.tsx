import { useCallback, useEffect, useState } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { useTenantTheme } from "./theme/tenantContext";
import { useGridStore } from "./store/useGridStore";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { VirtualGrid } from "./components/Grid/VirtualGrid";
import { Footer } from "./components/Footer";
import "./App.css";

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function AppShell() {
  const { theme } = useTenantTheme();
  const undo = useGridStore((s) => s.undo);
  const redo = useGridStore((s) => s.redo);
  const [domRowCount, setDomRowCount] = useState(0);

  // Global undo/redo shortcuts. Deliberately skipped while a cell's edit
  // input is focused, so the browser's native text-field undo handles the
  // *in-progress draft* and our command stack only ever governs committed,
  // validator-accepted edits (see ASSUMPTIONS.md, "undo scope").
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const handleDomRowCountChange = useCallback((n: number) => setDomRowCount(n), []);

  return (
    <div className="app">
      <header className="app__header">
        <h1>{theme.appName}</h1>
      </header>
      <Toolbar />
      <main className="app__grid">
        <VirtualGrid onDomRowCountChange={handleDomRowCountChange} />
      </main>
      <Footer domRowCount={domRowCount} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
