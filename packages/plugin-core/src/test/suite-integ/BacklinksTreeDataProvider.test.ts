import { NoteProps, NoteUtils, VaultUtils } from "@dendronhq/common-all";
import {
  NoteTestUtilsV4,
  NOTE_PRESETS_V4,
  toPlainObject,
} from "@dendronhq/common-test-utils";
import { TestConfigUtils } from "@dendronhq/engine-test-utils";
import _ from "lodash";
import path from "path";
import * as vscode from "vscode";
import { ProviderResult, Uri } from "vscode";
import { ReloadIndexCommand } from "../../commands/ReloadIndex";
import BacklinksTreeDataProvider, {
  Backlink,
  secondLevelRefsToBacklinks,
} from "../../features/BacklinksTreeDataProvider";
import { VSCodeUtils } from "../../vsCodeUtils";
import { getDWorkspace } from "../../workspace";
import { expect, runMultiVaultTest } from "../testUtilsv2";
import { runLegacyMultiWorkspaceTest, setupBeforeAfter } from "../testUtilsV3";
import { WSUtils } from "../../WSUtils";

type BacklinkWithChildren = Backlink & { children?: Backlink[] | undefined };

/** Asking for root children (asking for children without an input) from backlinks tree
 *  data provider will us the backlinks. */
const getRootChildrenBacklinks = async () => {
  const backlinksTreeDataProvider = new BacklinksTreeDataProvider(
    getDWorkspace().config.dev?.enableLinkCandidates
  );
  const parents = await backlinksTreeDataProvider.getChildren();
  const parentsWithChildren = [];

  if (parents !== undefined) {
    for (const parent of parents) {
      parentsWithChildren.push({
        ...parent,
        children: await backlinksTreeDataProvider.getChildren(parent),
      });
    }
  }

  return {
    out: parentsWithChildren,
    provider: backlinksTreeDataProvider,
  };
};

async function getRootChildrenBacklinksAsPlainObject() {
  const value = await getRootChildrenBacklinks();

  const cleanedOutVal = {
    ...value,
    out: cleanOutParentPointersFromList(value.out),
  };
  return toPlainObject(cleanedOutVal) as any;
}

/** Refer to {@link cleanOutParentPointers} */
function cleanOutParentPointersFromList(
  backlinks: BacklinkWithChildren[]
): BacklinkWithChildren[] {
  return backlinks.map((backlink) => {
    return cleanOutParentPointers(backlink);
  });
}

/** Return a copy of backlink with parent pointers cleaned out.
 *
 *  Need to remove parent references to avoid circular serialization error when trying
 *  to serialize the backlinks within our tests (our existing tests serialize
 *  the backlinks for their assertion checks). */
function cleanOutParentPointers(
  backlink: BacklinkWithChildren
): BacklinkWithChildren {
  const copy = { ...backlink };

  if (copy.children) {
    copy.children = cleanOutParentPointersFromList(copy.children);
  }

  copy.parentBacklink = undefined;

  if (copy.refs) {
    copy.refs = copy.refs.map((ref) => {
      const refCopy = { ...ref };
      refCopy.parentBacklink = undefined;
      return refCopy;
    });
  }

  return copy;
}

function backlinksToPlainObject(backlinks: Backlink[]) {
  return toPlainObject(cleanOutParentPointersFromList(backlinks));
}

function assertAreEqual(actual: ProviderResult<Backlink>, expected: Backlink) {
  if (actual instanceof Backlink) {
    actual = cleanOutParentPointers(actual);
  } else {
    throw new Error(
      `Actual type was '${typeof actual}'. Must be Backlink type for this assert.`
    );
  }
  expected = cleanOutParentPointers(expected);

  const plainActual = toPlainObject(actual);
  const plainExpected = toPlainObject(expected);

  expect(plainActual).toEqual(plainExpected);
}

suite("BacklinksTreeDataProvider", function () {
  let ctx: vscode.ExtensionContext;

  ctx = setupBeforeAfter(this, {
    beforeHook: () => {
      VSCodeUtils.closeAllEditors();
    },
    afterHook: () => {
      VSCodeUtils.closeAllEditors();
    },
  });

  test("basics", (done) => {
    let noteWithTarget: NoteProps;

    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          wsRoot,
          vault: vaults[0],
        });
        await NOTE_PRESETS_V4.NOTE_WITH_LINK.create({
          wsRoot,
          vault: vaults[0],
        });
      },
      onInit: async ({ wsRoot, vaults }) => {
        await WSUtils.openNote(noteWithTarget);
        const { out } = await getRootChildrenBacklinksAsPlainObject();
        const expectedPath = vscode.Uri.file(
          path.join(wsRoot, vaults[0].fsPath, "beta.md")
        ).path;
        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        expect(out.length).toEqual(1);
        done();
      },
    });
  });

  test("validate get parent works", (done) => {
    let noteWithTarget: NoteProps;

    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          wsRoot,
          vault: vaults[0],
        });
        await NOTE_PRESETS_V4.NOTE_WITH_LINK.create({
          wsRoot,
          vault: vaults[0],
        });
      },
      onInit: async () => {
        await WSUtils.openNote(noteWithTarget);
        const { out: backlinks, provider } = await getRootChildrenBacklinks();
        const parentBacklink = backlinks[0];

        // Our utility method will add the children into out backlink structure.
        // The provider will give just the backlink hence we will remove the
        // children from the structure that will be used to assert equality.
        const parentBacklinkForAssert = { ...parentBacklink };
        delete parentBacklinkForAssert.children;

        // Validate children added by the test setup are able to getParent()
        expect(parentBacklink.children).toBeTruthy();
        parentBacklink.children?.forEach((child) => {
          const foundParent = provider.getParent(child);
          assertAreEqual(foundParent, parentBacklinkForAssert);
        });

        // Validate backlinks created out of refs can getParent()
        expect(parentBacklink.refs).toBeTruthy();
        const childbacklinksFromRefs = secondLevelRefsToBacklinks(
          parentBacklink.refs!,
          provider.isLinkCandidateEnabled
        );
        expect(childbacklinksFromRefs).toBeTruthy();
        childbacklinksFromRefs?.forEach((backlink) => {
          const foundParent = provider.getParent(backlink);
          assertAreEqual(foundParent, parentBacklinkForAssert);
        });

        done();
      },
    });
  });

  test("from cache", (done) => {
    let noteWithTarget: NoteProps;

    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          wsRoot,
          vault: vaults[0],
        });
        await NOTE_PRESETS_V4.NOTE_WITH_LINK.create({
          wsRoot,
          vault: vaults[0],
        });
      },
      onInit: async ({ wsRoot, vaults }) => {
        // re-initialize engine from cache
        await new ReloadIndexCommand().run();
        await WSUtils.openNote(noteWithTarget);
        const { out } = await getRootChildrenBacklinksAsPlainObject();
        const expectedPath = vscode.Uri.file(
          path.join(wsRoot, vaults[0].fsPath, "beta.md")
        ).path;
        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        expect(out.length).toEqual(1);
        done();
      },
    });
  });

  test("with enableLinkCandidates from cache", (done) => {
    let noteWithTarget: NoteProps;

    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          wsRoot,
          vault: vaults[0],
        });
        await NOTE_PRESETS_V4.NOTE_WITH_LINK_CANDIDATE_TARGET.create({
          wsRoot,
          vault: vaults[0],
        });
      },
      onInit: async ({ wsRoot, vaults }) => {
        TestConfigUtils.withConfig(
          (config) => {
            config.dev = {
              enableLinkCandidates: true,
            };
            return config;
          },
          { wsRoot }
        );
        const isLinkCandidateEnabled = TestConfigUtils.getConfig({ wsRoot }).dev
          ?.enableLinkCandidates;
        expect(isLinkCandidateEnabled).toBeTruthy();

        await new ReloadIndexCommand().execute();
        await WSUtils.openNote(noteWithTarget);

        const { out } = await getRootChildrenBacklinksAsPlainObject();
        const expectedPath = vscode.Uri.file(
          path.join(wsRoot, vaults[0].fsPath, "gamma.md")
        ).path;
        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        const ref = out[0].refs[0];
        expect(ref.isCandidate).toBeTruthy();
        expect(ref.matchText as string).toEqual("alpha");
        done();
      },
    });
  });

  test("multi", (done) => {
    runMultiVaultTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        await NoteTestUtilsV4.createNote({
          fname: "alpha",
          body: `[[beta]]`,
          vault: vaults[0],
          wsRoot,
        });
        await NoteTestUtilsV4.createNote({
          fname: "beta",
          body: `[[alpha]]`,
          vault: vaults[1],
          wsRoot,
        });
      },
      onInit: async ({ wsRoot, vaults }) => {
        const notePath = path.join(wsRoot, vaults[0].fsPath, "alpha.md");
        await VSCodeUtils.openFileInEditor(Uri.file(notePath));
        const { out } = await getRootChildrenBacklinksAsPlainObject();
        const expectedPath = vscode.Uri.file(
          path.join(wsRoot, vaults[1].fsPath, "beta.md")
        ).path;
        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        expect(out.length).toEqual(1);
        done();
      },
    });
  });

  test("link candidates should only work within a vault", (done) => {
    let alpha: NoteProps;
    let gamma: NoteProps;
    runMultiVaultTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        alpha = await NoteTestUtilsV4.createNote({
          fname: "alpha",
          body: `gamma`,
          vault: vaults[0],
          wsRoot,
        });
        gamma = await NOTE_PRESETS_V4.NOTE_WITH_LINK_CANDIDATE_TARGET.create({
          wsRoot,
          vault: vaults[1],
        });
      },
      onInit: async ({ wsRoot }) => {
        TestConfigUtils.withConfig(
          (config) => {
            config.dev = {
              enableLinkCandidates: true,
            };
            return config;
          },
          { wsRoot }
        );

        await WSUtils.openNote(alpha);
        const alphaOut = (await getRootChildrenBacklinksAsPlainObject()).out;
        expect(alphaOut).toEqual([]);
        expect(alpha.links).toEqual([]);

        await WSUtils.openNote(gamma);
        const gammaOut = (await getRootChildrenBacklinksAsPlainObject()).out;
        expect(gammaOut).toEqual([]);
        expect(gamma.links).toEqual([]);
        done();
      },
    });
  });

  test("links and link candidates to correct subtree", (done) => {
    let alpha: NoteProps;
    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        alpha = await NoteTestUtilsV4.createNote({
          fname: "alpha",
          body: "this note has both links and candidates to it.",
          vault: vaults[0],
          wsRoot,
        });
        await NoteTestUtilsV4.createNote({
          fname: "beta",
          body: "[[alpha]]\nalpha",
          vault: vaults[0],
          wsRoot,
        });
      },
      onInit: async ({ wsRoot }) => {
        TestConfigUtils.withConfig(
          (config) => {
            config.dev = {
              enableLinkCandidates: true,
            };
            return config;
          },
          { wsRoot }
        );

        await new ReloadIndexCommand().execute();
        await WSUtils.openNote(alpha);
        const { out, provider } = await getRootChildrenBacklinks();
        const outObj = backlinksToPlainObject(out) as any;

        // source should be beta.md

        const sourceTreeItem = outObj[0];
        expect(sourceTreeItem.label).toEqual("beta.md");
        // it should have two subtrees
        expect(sourceTreeItem.children.length).toEqual(2);

        // a subtree for link(s), holding one backlink, "[[alpha]]"
        const linkSubTreeItem = sourceTreeItem.children[0];
        expect(linkSubTreeItem.label).toEqual("Linked");
        expect(linkSubTreeItem.refs.length).toEqual(1);
        expect(linkSubTreeItem.refs[0].matchText).toEqual("[[alpha]]");

        // a subtree for candidate(s), holding one candidate item, "alpha"
        const candidateSubTreeItem = sourceTreeItem.children[1];
        expect(candidateSubTreeItem.label).toEqual("Candidates");
        expect(candidateSubTreeItem.refs.length).toEqual(1);
        expect(candidateSubTreeItem.refs[0].matchText).toEqual("alpha");

        // in each subtree, TreeItems that hold actual links should exist.
        // they are leaf nodes (no children).
        const link = await provider.getChildren(out[0].children![0]);
        expect(link![0].label).toEqual("[[alpha]]");
        expect(link![0].refs).toEqual(undefined);

        const candidate = await provider.getChildren(out[0].children![1]);
        expect(candidate![0].label).toEqual("alpha");
        expect(candidate![0].refs).toEqual(undefined);

        done();
      },
    });
  });

  test("candidates subtree doesn't show up if feature flag was not enabled", (done) => {
    let alpha: NoteProps;
    let beta: NoteProps;
    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        alpha = await NoteTestUtilsV4.createNote({
          fname: "alpha",
          body: "[[beta]] beta",
          vault: vaults[0],
          wsRoot,
        });
        beta = await NoteTestUtilsV4.createNote({
          fname: "beta",
          body: "alpha",
          vault: vaults[0],
          wsRoot,
        });
      },
      onInit: async () => {
        await new ReloadIndexCommand().execute();
        await WSUtils.openNote(alpha);

        const { out: alphaOut } = await getRootChildrenBacklinks();
        const alphaOutObj = backlinksToPlainObject(alphaOut) as any;
        expect(_.isEmpty(alphaOutObj)).toBeTruthy();

        await WSUtils.openNote(beta);
        const { out: betaOut } = await getRootChildrenBacklinks();
        const betaOutObj = backlinksToPlainObject(betaOut) as any;
        expect(betaOutObj[0].children.length).toEqual(1);
        expect(betaOutObj[0].children[0].label).toEqual("Linked");

        done();
      },
    });
  });

  test("multi backlink items display correctly", (done) => {
    let alpha: NoteProps;

    runLegacyMultiWorkspaceTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        alpha = await NoteTestUtilsV4.createNote({
          fname: "alpha",
          body: "this note has many links and candidates to it.",
          vault: vaults[0],
          wsRoot,
        });
        await NoteTestUtilsV4.createNote({
          fname: "beta",
          body: "[[alpha]] alpha alpha [[alpha]] [[alpha]] alpha\nalpha\n\nalpha",
          vault: vaults[0],
          wsRoot,
        });
      },
      onInit: async ({ wsRoot }) => {
        TestConfigUtils.withConfig(
          (config) => {
            config.dev = {
              enableLinkCandidates: true,
            };
            return config;
          },
          { wsRoot }
        );

        // need this until we move it out of the feature flag.
        await new ReloadIndexCommand().execute();

        await WSUtils.openNote(alpha);
        const { out } = await getRootChildrenBacklinks();
        const outObj = backlinksToPlainObject(out) as any;

        // source should be beta.md

        const sourceTreeItem = outObj[0];
        expect(sourceTreeItem.label).toEqual("beta.md");
        // it should have two subtrees
        expect(sourceTreeItem.children.length).toEqual(2);

        // a subtree for link(s), holding three backlink
        const linkSubTreeItem = sourceTreeItem.children[0];
        expect(linkSubTreeItem.label).toEqual("Linked");
        expect(linkSubTreeItem.refs.length).toEqual(3);

        // a subtree for candidate(s), holding five candidate items
        const candidateSubTreeItem = sourceTreeItem.children[1];
        expect(candidateSubTreeItem.label).toEqual("Candidates");
        expect(candidateSubTreeItem.refs.length).toEqual(5);

        done();
      },
    });
  });

  test("xvault link", (done) => {
    runMultiVaultTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        await NoteTestUtilsV4.createNote({
          fname: "alpha",
          body: `[[beta]]`,
          vault: vaults[0],
          wsRoot,
        });
        await NoteTestUtilsV4.createNote({
          fname: "beta",
          body: `[[dendron://${VaultUtils.getName(vaults[0])}/alpha]]`,
          vault: vaults[1],
          wsRoot,
        });
      },
      onInit: async ({ wsRoot, vaults }) => {
        const notePath = path.join(wsRoot, vaults[0].fsPath, "alpha.md");
        await VSCodeUtils.openFileInEditor(Uri.file(notePath));
        const { out } = await getRootChildrenBacklinksAsPlainObject();
        const expectedPath = vscode.Uri.file(
          path.join(wsRoot, vaults[1].fsPath, "beta.md")
        ).path;
        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        expect(out.length).toEqual(1);
        done();
      },
    });
  });

  test("with anchor", (done) => {
    let noteWithTarget: NoteProps;
    let noteWithLink: NoteProps;

    runMultiVaultTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget = await NOTE_PRESETS_V4.NOTE_WITH_ANCHOR_TARGET.create({
          wsRoot,
          vault: vaults[0],
        });
        noteWithLink = await NOTE_PRESETS_V4.NOTE_WITH_ANCHOR_LINK.create({
          wsRoot,
          vault: vaults[0],
        });
      },
      onInit: async () => {
        await WSUtils.openNote(noteWithTarget);
        const { out } = await getRootChildrenBacklinksAsPlainObject();
        const expectedPath = vscode.Uri.file(
          NoteUtils.getFullPath({
            note: noteWithLink,
            wsRoot: getDWorkspace().wsRoot,
          })
        ).path;

        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        expect(out.length).toEqual(1);
        done();
      },
    });
  });

  test("with alias", (done) => {
    let noteWithTarget: NoteProps;
    let noteWithLink: NoteProps;

    runMultiVaultTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteWithTarget = await NOTE_PRESETS_V4.NOTE_WITH_TARGET.create({
          wsRoot,
          vault: vaults[0],
        });
        noteWithLink = await NOTE_PRESETS_V4.NOTE_WITH_ALIAS_LINK.create({
          wsRoot,
          vault: vaults[0],
        });
      },
      onInit: async ({ wsRoot }) => {
        await WSUtils.openNote(noteWithTarget);
        const { out } = await getRootChildrenBacklinksAsPlainObject();
        // assert.strictEqual(
        //   out[0].command.arguments[0].path.toLowerCase() as string,
        //   NoteUtils.getPathV4({ note: noteWithLink, wsRoot })
        // );
        const expectedPath = vscode.Uri.file(
          NoteUtils.getFullPath({
            note: noteWithLink,
            wsRoot,
          })
        ).path;
        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        expect(out.length).toEqual(1);
        done();
      },
    });
  });

  test("with hashtag", (done) => {
    let noteTarget: NoteProps;
    let noteWithLink: NoteProps;
    runMultiVaultTest({
      ctx,
      preSetupHook: async ({ wsRoot, vaults }) => {
        noteTarget = await NoteTestUtilsV4.createNote({
          wsRoot,
          vault: vaults[0],
          fname: "tags.my.test-0.tag",
        });
        noteWithLink = await NoteTestUtilsV4.createNote({
          wsRoot,
          vault: vaults[0],
          fname: "test",
          body: "#my.test-0.tag",
        });
      },
      onInit: async ({ wsRoot }) => {
        await WSUtils.openNote(noteTarget);
        const { out } = await getRootChildrenBacklinksAsPlainObject();
        const expectedPath = vscode.Uri.file(
          NoteUtils.getFullPath({
            note: noteWithLink,
            wsRoot,
          })
        ).path;
        expect(
          out[0].command.arguments[0].path.toLowerCase() as string
        ).toEqual(expectedPath.toLowerCase());
        expect(out.length).toEqual(1);
        done();
      },
    });
  });
});

// suite('BacklinksTreeDataProvider', () => {

//   it('should provide backlinks', async () => {
//     const link = rndName();
//     const name0 = rndName();
//     const name1 = rndName();

//     await createFile(`${link}.md`);
//     await createFile(`a-${name0}.md`, `First note with backlink [[${link}]]`);
//     await createFile(`b-${name1}.md`, `Second note with backlink [[${link}]]`);

//     const doc = await openTextDocument(`${link}.md`);
//     await window.showTextDocument(doc);

//     expect(toPlainObject(await getChildren())).toMatchObject([
//       {
//         collapsibleState: 2,
//         label: `a-${name0}.md`,
//         refs: expect.any(Array),
//         description: '(1) ',
//         tooltip: `${path.join(getWorkspaceFolder()!, `a-${name0}.md`)}`,
//         command: {
//           command: 'vscode.open',
//           arguments: [
//             expect.objectContaining({
//               path: Uri.file(path.join(getWorkspaceFolder()!, `a-${name0}.md`)).path,
//               scheme: 'file',
//             }),
//             {
//               selection: [
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//               ],
//             },
//           ],
//           title: 'Open File',
//         },
//         children: [
//           {
//             collapsibleState: 0,
//             label: '1:27',
//             description: `[[${link}]]`,
//             tooltip: `[[${link}]]`,
//             command: {
//               command: 'vscode.open',
//               arguments: [
//                 expect.objectContaining({
//                   path: Uri.file(path.join(getWorkspaceFolder()!, `a-${name0}.md`)).path,
//                   scheme: 'file',
//                 }),
//                 {
//                   selection: [
//                     {
//                       line: 0,
//                       character: 27,
//                     },
//                     {
//                       line: 0,
//                       character: expect.any(Number),
//                     },
//                   ],
//                 },
//               ],
//               title: 'Open File',
//             },
//           },
//         ],
//       },
//       {
//         collapsibleState: 2,
//         label: `b-${name1}.md`,
//         refs: expect.any(Array),
//         description: '(1) ',
//         tooltip: `${path.join(getWorkspaceFolder()!, `b-${name1}.md`)}`,
//         command: {
//           command: 'vscode.open',
//           arguments: [
//             expect.objectContaining({
//               path: Uri.file(path.join(getWorkspaceFolder()!, `b-${name1}.md`)).path,
//               scheme: 'file',
//             }),
//             {
//               selection: [
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//               ],
//             },
//           ],
//           title: 'Open File',
//         },
//         children: [
//           {
//             collapsibleState: 0,
//             label: '1:28',
//             description: `[[${link}]]`,
//             tooltip: `[[${link}]]`,
//             command: {
//               command: 'vscode.open',
//               arguments: [
//                 expect.objectContaining({
//                   path: Uri.file(path.join(getWorkspaceFolder()!, `b-${name1}.md`)).path,
//                   scheme: 'file',
//                 }),
//                 {
//                   selection: [
//                     {
//                       line: 0,
//                       character: 28,
//                     },
//                     {
//                       line: 0,
//                       character: expect.any(Number),
//                     },
//                   ],
//                 },
//               ],
//               title: 'Open File',
//             },
//           },
//         ],
//       },
//     ]);
//   });

//   it('should provide backlinks for file with parens in name', async () => {
//     const link = `Note (${rndName()})`;
//     const name0 = rndName();
//     const name1 = rndName();

//     await createFile(`${link}.md`);
//     await createFile(`a-${name0}.md`, `First note with backlink [[${link}]]`);
//     await createFile(`b-${name1}.md`, `Second note with backlink [[${link}]]`);

//     const doc = await openTextDocument(`${link}.md`);
//     await window.showTextDocument(doc);

//     expect(toPlainObject(await getChildren())).toMatchObject([
//       {
//         collapsibleState: 2,
//         label: `a-${name0}.md`,
//         refs: expect.any(Array),
//         description: '(1) ',
//         tooltip: `${path.join(getWorkspaceFolder()!, `a-${name0}.md`)}`,
//         command: {
//           command: 'vscode.open',
//           arguments: [
//             expect.objectContaining({
//               path: Uri.file(path.join(getWorkspaceFolder()!, `a-${name0}.md`)).path,
//               scheme: 'file',
//             }),
//             {
//               selection: [
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//               ],
//             },
//           ],
//           title: 'Open File',
//         },
//         children: [
//           {
//             collapsibleState: 0,
//             label: '1:27',
//             description: `[[${link}]]`,
//             tooltip: `[[${link}]]`,
//             command: {
//               command: 'vscode.open',
//               arguments: [
//                 expect.objectContaining({
//                   path: Uri.file(path.join(getWorkspaceFolder()!, `a-${name0}.md`)).path,
//                   scheme: 'file',
//                 }),
//                 {
//                   selection: [
//                     {
//                       line: 0,
//                       character: 27,
//                     },
//                     {
//                       line: 0,
//                       character: expect.any(Number),
//                     },
//                   ],
//                 },
//               ],
//               title: 'Open File',
//             },
//           },
//         ],
//       },
//       {
//         collapsibleState: 2,
//         label: `b-${name1}.md`,
//         refs: expect.any(Array),
//         description: '(1) ',
//         tooltip: `${path.join(getWorkspaceFolder()!, `b-${name1}.md`)}`,
//         command: {
//           command: 'vscode.open',
//           arguments: [
//             expect.objectContaining({
//               path: Uri.file(path.join(getWorkspaceFolder()!, `b-${name1}.md`)).path,
//               scheme: 'file',
//             }),
//             {
//               selection: [
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//                 {
//                   line: 0,
//                   character: 0,
//                 },
//               ],
//             },
//           ],
//           title: 'Open File',
//         },
//         children: [
//           {
//             collapsibleState: 0,
//             label: '1:28',
//             description: `[[${link}]]`,
//             tooltip: `[[${link}]]`,
//             command: {
//               command: 'vscode.open',
//               arguments: [
//                 expect.objectContaining({
//                   path: Uri.file(path.join(getWorkspaceFolder()!, `b-${name1}.md`)).path,
//                   scheme: 'file',
//                 }),
//                 {
//                   selection: [
//                     {
//                       line: 0,
//                       character: 28,
//                     },
//                     {
//                       line: 0,
//                       character: expect.any(Number),
//                     },
//                   ],
//                 },
//               ],
//               title: 'Open File',
//             },
//           },
//         ],
//       },
//     ]);
//   });

//   it('should not provide backlinks for link within code span', async () => {
//     const link = rndName();
//     const name0 = rndName();

//     await createFile(`${link}.md`);
//     await createFile(`a-${name0}.md`, `\`[[${link}]]\``);

//     const doc = await openTextDocument(`${link}.md`);
//     await window.showTextDocument(doc);

//     expect(toPlainObject(await getChildren())).toHaveLength(0);
//   });

//   it('should not provide backlinks for link within code span 2', async () => {
//     const link = rndName();
//     const name0 = rndName();

//     await createFile(`${link}.md`);
//     await createFile(
//       `a-${name0}.md`,
//       `
//     Preceding text
//     \`[[${link}]]\`
//     Following text
//     `,
//     );

//     const doc = await openTextDocument(`${link}.md`);
//     await window.showTextDocument(doc);

//     expect(toPlainObject(await getChildren())).toHaveLength(0);
//   });

//   it('should not provide backlinks for link within fenced code block', async () => {
//     const link = rndName();
//     const name0 = rndName();

//     await createFile(`${link}.md`);
//     await createFile(
//       `a-${name0}.md`,
//       `
//     \`\`\`
//     Preceding text
//     [[${link}]]
//     Following text
//     \`\`\`
//     `,
//     );

//     const doc = await openTextDocument(`${link}.md`);
//     await window.showTextDocument(doc);

//     expect(toPlainObject(await getChildren())).toHaveLength(0);
//   });

//   it('should collapse parent items according to configuration', async () => {
//     const link = rndName();
//     const name0 = rndName();
//     const name1 = rndName();

//     await createFile(`${link}.md`);
//     await createFile(`a-${name0}.md`, `First note with backlink [[${link}]]`);
//     await createFile(`b-${name1}.md`, `Second note with backlink [[${link}]]`);

//     const doc = await openTextDocument(`${link}.md`);

//     await window.showTextDocument(doc);

//     await updateMemoConfigProperty('backlinksPanel.collapseParentItems', true);

//     expect((await getChildren()).every((child) => child.collapsibleState === 1)).toBe(true);
//   });

//   it('should expand parent items according to config', async () => {
//     const link = rndName();
//     const name0 = rndName();
//     const name1 = rndName();

//     await createFile(`${link}.md`);
//     await createFile(`a-${name0}.md`, `First note with backlink [[${link}]]`);
//     await createFile(`b-${name1}.md`, `Second note with backlink [[${link}]]`);

//     const doc = await openTextDocument(`${link}.md`);

//     await window.showTextDocument(doc);

//     expect(getMemoConfigProperty('backlinksPanel.collapseParentItems', null)).toBe(false);

//     expect((await getChildren()).every((child) => child.collapsibleState === 2)).toBe(true);
//   });
// });
