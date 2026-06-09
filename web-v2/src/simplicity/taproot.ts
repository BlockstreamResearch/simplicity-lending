import {
  SimplicityProgram,
  StateTaprootBuilder,
  type StateTaprootSpendInfo,
  XOnlyPublicKey,
} from 'lwk_web'

// https://github.com/BlockstreamResearch/smplx/blob/1c0ca5fc0de828c6bc9c35a6a26a8b86d48ffaf4/crates/sdk/src/utils.rs#L27
export const NUMS_KEY = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

export function buildCovenantSpendInfo(program: SimplicityProgram): StateTaprootSpendInfo {
  return new StateTaprootBuilder()
    .addSimplicityLeaf(0, program.cmr)
    .finalize(XOnlyPublicKey.fromString(NUMS_KEY))
}
