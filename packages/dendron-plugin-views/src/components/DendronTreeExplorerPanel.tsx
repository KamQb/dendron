import {
  DMessageSource,
  DNodeUtils,
  TreeViewMessage,
  TreeViewMessageEnum,
} from "@dendronhq/common-all";
import { createLogger, TreeViewUtils } from "@dendronhq/common-frontend";
import { Spin, Tree, TreeProps } from "antd";
import _ from "lodash";
import { DataNode } from "rc-tree/lib/interface";
import React, { useState } from "react";
import { DendronComponent } from "../types";
import { postVSCodeMessage } from "../utils/vscode";
type OnExpandFunc = TreeProps["onExpand"];
type OnSelectFunc = TreeProps["onSelect"];
const DendronTreeExplorerPanel: DendronComponent = (props) => {
  const logger = createLogger("DendronTreeExplorerPanel");
  const noteActive = props.ide.noteActive;
  const engine = props.engine;
  const { config, notes } = engine;
  const [activeNoteIds, setActiveNoteIds] = useState<string[]>([]);
  const [roots, setRoots] = useState<DataNode[]>([]);
  const numNotes = _.size(notes);

  logger.info({
    msg: "enter",
    noteActive: noteActive ? noteActive.id : "no active note found",
    config,
    numNotes,
  });

  // update active notes in tree
  React.useEffect(() => {
    if (!_.isUndefined(noteActive)) {
      logger.info({ msg: "calcActiveNoteIds:pre" });
      const _activeNoteIds = TreeViewUtils.getAllParents({
        notes,
        noteId: noteActive.id,
      });
      logger.info({ msg: "setActiveNoteIds:pre" });
      setActiveNoteIds(_activeNoteIds);
      logger.info({ msg: "setActiveNoteIds:post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numNotes, noteActive?.id]);

  // calculate root
  React.useEffect(() => {
    // calculate roots once on startup
    logger.info({ msg: "calcRoots:pre", numNotes });
    const _roots = _.filter(_.values(engine.notes), DNodeUtils.isRoot).map(
      (ent) => {
        return TreeViewUtils.note2TreeDatanote({
          noteDict: notes,
          applyNavExclude: false,
          noteId: ent.id,
          showVaultName: true,
        });
      }
    ) as DataNode[];
    logger.info({ msg: "calcRoots:post", numNotes });
    setRoots(_roots);
    // TODO: remove notes
    logger.info({ msg: "calcRoots:post:setRoots", numNotes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numNotes]);

  const expandKeys = _.isEmpty(activeNoteIds) ? [] : activeNoteIds;
  const onExpand: OnExpandFunc = (expandedKeys, { node, expanded }) => {
    const id = node.key as string;
    logger.info({ ctx: "onExpand", expandedKeys, id, expanded });
    // open up
    if (expanded) {
      setActiveNoteIds(
        TreeViewUtils.getAllParents({ notes: engine.notes!, noteId: id })
      );
    } else {
      setActiveNoteIds(
        TreeViewUtils.getAllParents({ notes: engine.notes!, noteId: id }).slice(
          0,
          -1
        )
      );
    }
  };
  const onSelect: OnSelectFunc = (_selectedKeys, { node }) => {
    const id = node.key;
    logger.info({ ctx: "onSelect", id });
    postVSCodeMessage({
      type: TreeViewMessageEnum.onSelect,
      data: { id },
      source: DMessageSource.webClient,
    } as TreeViewMessage);
  };
  logger.info({ msg: "exit", expandKeys });

  return (
    <>
      <TreeView
        treeData={roots}
        defaultExpandKeys={expandKeys}
        onExpand={onExpand}
        onSelect={onSelect}
      />
    </>
  );
};

function TreeView({
  treeData,
  defaultExpandKeys,
  ...rest
}: {
  treeData: DataNode[];
  defaultExpandKeys: string[];
  onExpand: OnExpandFunc;
  onSelect: OnSelectFunc;
}) {
  const logger = createLogger("TreeView");
  logger.info({ msg: "enter", defaultExpandKeys, treeData });
  return (
    <>
      {treeData.length ? (
        <Tree
          showIcon
          expandedKeys={defaultExpandKeys}
          selectedKeys={defaultExpandKeys.slice(-1)}
          treeData={treeData}
          {...rest}
        />
      ) : (
        <Spin />
      )}
    </>
  );
}

export default DendronTreeExplorerPanel;
