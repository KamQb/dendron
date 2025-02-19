import {
  ConfigUtils,
  IntermediateDendronConfig,
  NoteProps,
} from "@dendronhq/common-all";
import {
  createLogger,
  engineHooks,
  engineSlice,
} from "@dendronhq/common-frontend";
import { Mermaid } from "mermaid";
import React from "react";
import { DendronProps, WorkspaceProps } from "../types";

export const useCurrentTheme = () => {
  const [currentTheme, setCurrentTheme] = React.useState<"light" | "dark">(
    "light"
  );
  React.useEffect(() => {
    // @ts-ignore
    setCurrentTheme(window.currentTheme);
  }, [setCurrentTheme, currentTheme]);
  return { currentTheme, setCurrentTheme };
};

export const useWorkspaceProps = (): [WorkspaceProps] => {
  const elem = window.document.getElementById("root")!;
  const port = parseInt(elem.getAttribute("data-port")!, 10);
  const ws = elem.getAttribute("data-ws")!;
  const isBrowser = elem.getAttribute("data-browser")! === "true";
  const theme = elem.getAttribute("data-browser")!;
  return [
    {
      port,
      ws,
      browser: isBrowser,
      theme,
    },
  ];
};

/**
 * Body of current note
 * @param param0
 * @returns
 */
export const useRenderedNoteBody = ({
  engine,
  noteProps,
  workspace,
}: DendronProps & { noteProps?: NoteProps }) => {
  const { id: noteId, contentHash } = noteProps || {
    id: undefined,
    contentHash: undefined,
  };
  const noteContent = engine.notesRendered[noteId || ""];
  const renderedNoteContentHash = React.useRef<string>();
  const dispatch = engineHooks.useEngineAppDispatch();

  React.useEffect(() => {
    if (!noteId) {
      return;
    }
    // if no "render to markdown" has happended or the note body changed
    if (!noteContent || contentHash !== renderedNoteContentHash.current) {
      renderedNoteContentHash.current = contentHash;
      dispatch(engineSlice.renderNote({ ...workspace, id: noteId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, contentHash]);
  // }, [noteId, contentHash, dispatch, noteContent, workspace]);

  return [noteContent];
};

/**
 * Initialize mermaid if it is enabled
 */
export const useMermaid = ({
  config,
  themeType,
  mermaid,
  noteRenderedBody,
}: {
  config?: IntermediateDendronConfig;
  themeType: "light" | "dark";
  mermaid: Mermaid;
  noteRenderedBody?: string;
}) => {
  React.useEffect(() => {
    const logger = createLogger("useMermaid");
    if (config && ConfigUtils.getPreview(config)?.enableMermaid) {
      mermaid.initialize({
        startOnLoad: true,
        theme: themeType === "light" ? "forest" : "dark",
      });
      // use for debugging
      // @ts-ignore
      window._mermaid = mermaid;
      // @ts-ignore
      mermaid.init();
      logger.info({ msg: "init mermaid library", themeType });
    } else {
      logger.info("skip mermaid library");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, noteRenderedBody, themeType]);
};

/**
 * Metadata about current note
 * @param param0
 * @returns
 */
export const useNoteProps = ({
  engine,
  noteId,
}: DendronProps & { noteId: string }) => {
  const maybeNote = engine.notes[noteId];
  if (!maybeNote) {
    throw Error(`note with id ${noteId} not found`);
  }
  return [maybeNote];
};
