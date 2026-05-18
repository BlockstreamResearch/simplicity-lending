use std::cmp::min;

use crate::utils::apply_basis_points;

#[derive(Debug, Clone, Copy)]
pub struct OfferParameters {
    pub collateral_amount: u64,
    pub principal_amount: u64,
    pub loan_expiration_time: u32,
    pub principal_interest_rate: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfferRepaymentPhase {
    NoRepayments,
    RepayingOfferFee,
    RepayingPrincipal,
    Repaid,
}

const PROTOCOL_FEE_PERCENTAGE: u16 = 1_000; // 10%

pub fn calculate_protocol_fee(fee_amount: u64) -> u64 {
    apply_basis_points(fee_amount, PROTOCOL_FEE_PERCENTAGE).unwrap()
}

impl OfferParameters {
    pub fn get_total_fee(&self) -> u64 {
        apply_basis_points(self.principal_amount, self.principal_interest_rate).unwrap()
    }

    pub fn get_total_protocol_fee(&self) -> u64 {
        calculate_protocol_fee(self.get_total_fee())
    }

    pub fn get_fee_to_repay(&self, current_debt: u64) -> u64 {
        let total_fee = self.get_total_fee();

        let already_repaid_amount = self.get_already_repaid_amount(current_debt);
        let already_repaid_fee = min(total_fee, already_repaid_amount);

        total_fee - already_repaid_fee
    }

    pub fn get_protocol_fee_to_repay(&self, current_debt: u64) -> u64 {
        calculate_protocol_fee(self.get_fee_to_repay(current_debt))
    }

    pub fn get_repaid_fee(&self, current_debt: u64, amount_to_repay: u64) -> u64 {
        let fee_left = self.get_fee_to_repay(current_debt);

        min(fee_left, amount_to_repay)
    }

    pub fn get_repaid_protocol_fee(&self, current_debt: u64, amount_to_repay: u64) -> u64 {
        calculate_protocol_fee(self.get_repaid_fee(current_debt, amount_to_repay))
    }

    pub fn get_total_amount_to_repay(&self) -> u64 {
        self.principal_amount + self.get_total_fee()
    }

    pub fn get_already_repaid_amount(&self, current_debt: u64) -> u64 {
        let total_amount_to_repay = self.get_total_amount_to_repay();

        total_amount_to_repay.saturating_sub(current_debt)
    }

    pub fn get_repayment_phase(&self, offer_debt: u64) -> OfferRepaymentPhase {
        let total_amount_to_repay = self.get_total_amount_to_repay();

        if offer_debt >= total_amount_to_repay {
            return OfferRepaymentPhase::NoRepayments;
        }

        if offer_debt == 0 {
            return OfferRepaymentPhase::Repaid;
        }

        let total_fee = self.get_total_fee();
        let repaid_amount = total_amount_to_repay - offer_debt;

        if total_fee > repaid_amount {
            OfferRepaymentPhase::RepayingOfferFee
        } else {
            OfferRepaymentPhase::RepayingPrincipal
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{OfferParameters, OfferRepaymentPhase};

    fn dummy_lending_offer_parameters(
        principal_amount: u64,
        principal_interest_rate: u16,
    ) -> OfferParameters {
        OfferParameters {
            collateral_amount: 1_000_000,
            principal_amount,
            loan_expiration_time: 100_000,
            principal_interest_rate,
        }
    }

    #[test]
    fn get_total_fee_returns_correct_fee_amount() {
        let params = dummy_lending_offer_parameters(1000, 500);

        assert_eq!(params.get_total_fee(), 50);

        let params = dummy_lending_offer_parameters(1000, 0);

        assert_eq!(params.get_total_fee(), 0);

        let params = dummy_lending_offer_parameters(1000, 10000);

        assert_eq!(params.get_total_fee(), 1000);
    }

    #[test]
    fn get_total_protocol_fee_returns_correct_fee_amount() {
        let params = dummy_lending_offer_parameters(1000, 5000);

        assert_eq!(params.get_total_protocol_fee(), 50);

        let params = dummy_lending_offer_parameters(1000, 0);

        assert_eq!(params.get_total_protocol_fee(), 0);

        let params = dummy_lending_offer_parameters(1000, 10000);

        assert_eq!(params.get_total_protocol_fee(), 100);
    }

    #[test]
    fn get_total_amount_to_repay_returns_correct_amount() {
        let params = dummy_lending_offer_parameters(1000, 500);

        assert_eq!(params.get_total_amount_to_repay(), 1050);

        let params = dummy_lending_offer_parameters(1000, 0);

        assert_eq!(params.get_total_amount_to_repay(), 1000);

        let params = dummy_lending_offer_parameters(1000, 10000);

        assert_eq!(params.get_total_amount_to_repay(), 2000);
    }

    #[test]
    fn get_repayment_phase_returns_correct_values() {
        let params = dummy_lending_offer_parameters(1000, 500);

        let total_debt = 1050;

        assert_eq!(
            params.get_repayment_phase(total_debt),
            OfferRepaymentPhase::NoRepayments
        );
        assert_eq!(
            params.get_repayment_phase(total_debt - 10),
            OfferRepaymentPhase::RepayingOfferFee
        );
        assert_eq!(
            params.get_repayment_phase(total_debt - 100),
            OfferRepaymentPhase::RepayingPrincipal
        );
        assert_eq!(params.get_repayment_phase(0), OfferRepaymentPhase::Repaid);
    }

    #[test]
    fn get_already_repaid_amount_returns_correct_values() {
        let params = dummy_lending_offer_parameters(1000, 500);

        let total_debt = 1050;

        assert_eq!(params.get_already_repaid_amount(total_debt), 0);

        let repaid_amount = 10;
        assert_eq!(
            params.get_already_repaid_amount(total_debt - repaid_amount),
            repaid_amount
        );

        let repaid_amount = 250;
        assert_eq!(
            params.get_already_repaid_amount(total_debt - repaid_amount),
            repaid_amount
        );

        assert_eq!(params.get_already_repaid_amount(0), total_debt);
    }

    #[test]
    fn get_fee_to_repay_returns_correct_values() {
        let params = dummy_lending_offer_parameters(1000, 1000);

        let total_debt = 1100;
        let total_fee = 100;

        assert_eq!(params.get_fee_to_repay(total_debt), total_fee);

        let repaid_amount = 50;

        assert_eq!(
            params.get_fee_to_repay(total_debt - repaid_amount),
            total_fee - repaid_amount
        );

        let repaid_amount = 150;

        assert_eq!(params.get_fee_to_repay(total_debt - repaid_amount), 0);
    }

    #[test]
    fn get_protocol_fee_to_repay_returns_correct_values() {
        let params = dummy_lending_offer_parameters(1000, 5000);

        let total_debt = 1500;
        let total_protocol_fee = 50;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt),
            total_protocol_fee
        );

        let repaid_amount = 50;
        let repaid_protocol_fee_amount = 5;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt - repaid_amount),
            total_protocol_fee - repaid_protocol_fee_amount
        );

        let repaid_amount = 150;
        let repaid_protocol_fee_amount = 15;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt - repaid_amount),
            total_protocol_fee - repaid_protocol_fee_amount
        );

        let repaid_amount = 750;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt - repaid_amount),
            0
        );
    }

    #[test]
    fn get_repaid_fee_returns_correct_values() {
        let params = dummy_lending_offer_parameters(1000, 1000);

        let total_debt = 1100;
        let total_fee = 100;

        let amount_to_repay = 50;

        assert_eq!(
            params.get_repaid_fee(total_debt, amount_to_repay),
            amount_to_repay
        );

        let amount_to_repay = 150;

        assert_eq!(
            params.get_repaid_fee(total_debt, amount_to_repay),
            total_fee
        );

        let repaid_amount = 75;
        let amount_to_repay = 150;

        assert_eq!(
            params.get_repaid_fee(total_debt - repaid_amount, amount_to_repay),
            total_fee - repaid_amount
        );

        let repaid_amount = 150;
        let amount_to_repay = 150;

        assert_eq!(
            params.get_repaid_fee(total_debt - repaid_amount, amount_to_repay),
            0
        );
    }

    #[test]
    fn get_repaid_protocol_fee_returns_correct_values() {
        let params = dummy_lending_offer_parameters(1000, 5000);

        let total_debt = 1500;
        let total_protocol_fee = 50;

        let amount_to_repay = 50;
        let repaid_protocol_fee_amount = 5;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt, amount_to_repay),
            repaid_protocol_fee_amount
        );

        let amount_to_repay = 1000;
        let repaid_protocol_fee_amount = total_protocol_fee;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt, amount_to_repay),
            repaid_protocol_fee_amount
        );

        let repaid_amount = 300;
        let amount_to_repay = 1000;
        let repaid_protocol_fee_amount = 20;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt - repaid_amount, amount_to_repay),
            repaid_protocol_fee_amount
        );

        let repaid_amount = 600;
        let amount_to_repay = 200;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt - repaid_amount, amount_to_repay),
            0
        );
    }
}
