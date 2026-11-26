#[derive(Debug, Clone)]
pub struct OfferCreationOutputs {
    pub pending_offer_vout: u32,
    pub borrower_nft_vout: u32,
    pub borrower_nft_script_pubkey: Vec<u8>,
    pub lender_nft_vout: u32,
    pub lender_nft_script_pubkey: Vec<u8>,
}
