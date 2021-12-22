import { ENGINE_HOOKS } from "@dendronhq/engine-test-utils";
import * as vscode from "vscode";
import { expect } from "../testUtilsv2";
import { suite, beforeEach } from "mocha";
import { describeMultiWS, setupBeforeAfter } from "../testUtilsV3";
import { VaultSelectionModeKeeper } from "../../components/lookup/vaultSelectionModeKeeper";
import { VaultSelectionMode } from "../../components/lookup/types";

suite("VaultSelectionModeKeeper", function () {
  const ctx: vscode.ExtensionContext = setupBeforeAfter(this, {});

  describeMultiWS(
    "GIVEN VaultSelectionModeKeeper with recordDeviationFromConfig modified",
    {
      ctx,
      preSetupHook: ENGINE_HOOKS.setupBasic,
    },
    () => {
      beforeEach(() => {
        VaultSelectionModeKeeper.recordDeviationFromConfig(
          VaultSelectionMode.alwaysPrompt
        );
      });

      test("WHEN no options provided THEN use the modified value of always Prompt.", () => {
        const alwaysPrompt =
          VaultSelectionModeKeeper.vaultButtonPressedInitialState({});
        expect(alwaysPrompt).toEqual(true);
      });

      test("WHEN options provided alwaysPrompt THEN use option value", () => {
        const alwaysPrompt =
          VaultSelectionModeKeeper.vaultButtonPressedInitialState({
            optionsOverride: VaultSelectionMode.alwaysPrompt,
          });
        expect(alwaysPrompt).toEqual(true);
      });

      test("WHEN options provided smart THEN use option value", () => {
        const alwaysPrompt =
          VaultSelectionModeKeeper.vaultButtonPressedInitialState({
            optionsOverride: VaultSelectionMode.smart,
          });
        expect(alwaysPrompt).toEqual(false);
      });
    }
  );
});
