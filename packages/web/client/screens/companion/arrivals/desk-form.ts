import { useMemo, useSyncExternalStore } from "react";

import {
  DEFAULT_DESK_FORM,
  deskFormFor,
  keepDeskForms,
  landDeskForms,
  parseDeskForm,
  parseDeskForms,
  withDeskForm,
  type DeskForm,
  type DeskFormChoice,
  type DeskForms,
} from "./desk-form-model.ts";
import type { ScopeWho } from "./figure-scope-model.ts";

export * from "./desk-form-model.ts";

/*
 * Figure or strip, per attached agent (desk-form-model.ts). This page's
 * storage, like the figure look: picks per pin and per project, the default
 * each pin landed as (see land), and the default new pins land as. Storage
 * can be missing or full; the choice still holds for this session.
 */

// v2 (2026-10-15): the default became the strip. The picks under the old key
// were mostly figures frozen at landing, so every agent starts over as a strip.
// Pins landed before the project level kept their landing here, as picks of their own.
const FORMS_KEY = "scout:companion:desk-forms-v2";
const PROJECT_FORMS_KEY = "scout:companion:desk-forms-projects";
const LANDED_KEY = "scout:companion:desk-forms-landed";
const DEFAULT_KEY = "scout:companion:desk-form";
const listeners = new Set<() => void>();

let forms: DeskForms | null = null;
let projectForms: DeskForms | null = null;
let landedForms: DeskForms | null = null;
let fallback: DeskForm | null = null;

function readForms(key: string): DeskForms {
  try {
    return parseDeskForms(window.localStorage.getItem(key));
  } catch {
    return {};
  }
}

function store(key: string, value: DeskForms): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* the choice still holds for this session */ }
}

export function getProjectDeskForms(): DeskForms {
  projectForms ??= readForms(PROJECT_FORMS_KEY);
  return projectForms;
}

export function getLandedDeskForms(): DeskForms {
  landedForms ??= readForms(LANDED_KEY);
  return landedForms;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDeskForms(): DeskForms {
  if (forms === null) {
    try {
      forms = parseDeskForms(window.localStorage.getItem(FORMS_KEY));
    } catch {
      forms = {};
    }
  }
  return forms;
}

export function getDefaultDeskForm(): DeskForm {
  if (fallback === null) {
    try {
      fallback = parseDeskForm(window.localStorage.getItem(DEFAULT_KEY));
    } catch {
      fallback = DEFAULT_DESK_FORM;
    }
  }
  return fallback;
}

function choiceNow(): DeskFormChoice {
  return { agents: getDeskForms(), projects: getProjectDeskForms(), landed: getLandedDeskForms(), fallback: getDefaultDeskForm() };
}

/** How this pin is drawn: its own pick, its project's, the default it landed as, else the default. */
export function formOf(id: string, project: string | null = null): DeskForm {
  return deskFormFor(choiceNow(), { id, project });
}

function writeForms(next: DeskForms): void {
  if (next === getDeskForms()) return;
  forms = next;
  try {
    window.localStorage.setItem(FORMS_KEY, JSON.stringify(next));
  } catch { /* the choice still holds for this session */ }
  emit();
}

/** One pin's pick; null follows the default again. */
export function setDeskForm(id: string, form: DeskForm | null): void {
  writeForms(withDeskForm(getDeskForms(), id, form));
}

/** One project's pick; null follows the default again. */
export function setProjectDeskForm(project: string, form: DeskForm | null): void {
  const next = withDeskForm(getProjectDeskForms(), project, form);
  if (next === getProjectDeskForms()) return;
  projectForms = next;
  store(PROJECT_FORMS_KEY, next);
  emit();
}

function writeLanded(next: DeskForms): void {
  if (next === getLandedDeskForms()) return;
  landedForms = next;
  store(LANDED_KEY, next);
  emit();
}

/** Forget picks and landings for pins the host no longer has; project picks stay. */
export function prune(pinIds: Iterable<string>): void {
  const ids = [...pinIds];
  writeForms(keepDeskForms(getDeskForms(), ids));
  writeLanded(keepDeskForms(getLandedDeskForms(), ids));
}

/** Pins on the desk with no pick of their own keep the default they landed as, whatever the default becomes. */
export function land(placedIds: Iterable<string>): void {
  const own = getDeskForms();
  writeLanded(landDeskForms(getLandedDeskForms(), [...placedIds].filter((id) => !Object.hasOwn(own, id)), getDefaultDeskForm()));
}

export function setDefaultDeskForm(form: DeskForm): void {
  if (form === getDefaultDeskForm()) return;
  fallback = form;
  try {
    window.localStorage.setItem(DEFAULT_KEY, form);
  } catch { /* the choice still holds for this session */ }
  emit();
}

// The server snapshot is the live value too, so a server render (and its
// tests) draws what this page would.
export function useDeskForms(): DeskForms {
  return useSyncExternalStore(subscribe, getDeskForms, getDeskForms);
}

export function useDefaultDeskForm(): DeskForm {
  return useSyncExternalStore(subscribe, getDefaultDeskForm, getDefaultDeskForm);
}

/** Every level together, as the desk resolves each pin's form (deskFormResolve). */
export function useDeskFormChoice(): DeskFormChoice {
  const agents = useDeskForms();
  const projects = useSyncExternalStore(subscribe, getProjectDeskForms, getProjectDeskForms);
  const landed = useSyncExternalStore(subscribe, getLandedDeskForms, getLandedDeskForms);
  const value = useDefaultDeskForm();
  return useMemo(() => ({ agents, projects, landed, fallback: value }), [agents, projects, landed, value]);
}

export function useDeskForm(who: ScopeWho): DeskForm {
  return deskFormFor(useDeskFormChoice(), who);
}
