use lending_indexer::api::{MAX_LIST_LIMIT, ProtocolFeeVaultDto};
use lending_indexer::client::ProtocolFeeVaultsParams;

use crate::AppContext;
use crate::error::HarvesterError;

pub struct ClaimableVaults {
    pub total_count: u64,
    pub total_amount: String,
    pub items: Vec<ProtocolFeeVaultDto>,
}

pub async fn fetch_claimable_vaults(ctx: &AppContext) -> Result<ClaimableVaults, HarvesterError> {
    let mut offset = 0;
    let mut items = Vec::new();
    let mut total_count = 0;
    let mut total_amount = String::new();

    loop {
        let params = ProtocolFeeVaultsParams::new(ctx.settings.principal_asset.clone())
            .with_limit(MAX_LIST_LIMIT)
            .with_offset(offset);
        let page = ctx.indexer.list_protocol_fee_vaults(&params).await?;

        if offset == 0 {
            total_count = page.total_count;
            total_amount = page.total_amount;
        }

        let page_len = page.items.len() as u64;
        if page_len == 0 {
            break;
        }

        items.extend(page.items);
        offset += page_len;

        if offset >= total_count {
            break;
        }
    }

    Ok(ClaimableVaults {
        total_count,
        total_amount,
        items,
    })
}
