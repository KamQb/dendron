import { NoteUtils, VaultUtils } from "@dendronhq/common-all";
import { cleanName } from "@dendronhq/common-server";
import { DENDRON_COMMANDS } from "../constants";
import { DendronClientUtilsV2 } from "../utils";
import { getWS } from "../workspace";
import { BaseCommand } from "./base";
import { GotoNoteCommand } from "./GotoNote";
import { PickerUtilsV2 } from "../components/lookup/utils";
import * as vscode from "vscode";

type CommandOpts = {
  fname: string;
};

type CommandInput = {
  title: string;
};

export class CreateDailyJournalCommand extends BaseCommand<
  CommandOpts,
  any,
  CommandInput
> {
  static key = DENDRON_COMMANDS.CREATE_DAILY_JOURNAL_NOTE.key;
  async gatherInputs(): Promise<CommandInput | undefined> {
    const dailyJournalDomain = getWS().config.journal.dailyDomain;
    let fname: string;
    fname = DendronClientUtilsV2.genNoteName("JOURNAL", {
      overrides: { domain: dailyJournalDomain },
    });
    return { title: fname };
  }

  async enrichInputs(inputs: CommandInput) {
    let { title } = inputs;
    return {
      title,
      fname: `${cleanName(title)}`,
    };
  }

  async execute(opts: CommandOpts) {
    const { fname } = opts;
    const ctx = "CreateDailyJournal";
    const journalName = getWS().config.journal.name;
    this.L.info({ ctx, journalName, fname });
    const title = NoteUtils.genJournalNoteTitle({
      fname,
      journalName,
    });
    const engine = getWS().getEngine();
    const config = getWS().config;
    let vault;
    if (config.lookupConfirmVaultOnCreate) {
      vault = await PickerUtilsV2.promptVault(engine.vaults);
      if (vault === undefined) {
        vscode.window.showInformationMessage(
          "Daily Journal creation cancelled"
        );
        return;
      }
    } else {
      vault = config.defaultDailyJournalVault
        ? VaultUtils.getVaultByName({
            vaults: engine.vaults,
            vname: config.defaultDailyJournalVault,
          })
        : undefined;
    }

    await new GotoNoteCommand().execute({
      qs: fname,
      vault: vault,
      overrides: { title },
    });
  }
}
