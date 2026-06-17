use utoipa::OpenApi;

use crate::api::borrowers::dto::{AssetAmount, BorrowerDashboardResponse, BorrowerOverview};
use crate::api::borrowers::handlers as borrower_handlers;
use crate::api::error::{ErrorBody, ErrorResponse};
use crate::api::factories::dto::{
    FactoryAuthUtxoDto, FactoryDetailsResponse, FactoryProgramUtxoDto,
};
use crate::api::factories::handlers as factory_handlers;
use crate::api::offers::dto::{
    OfferListItemShort, OfferListResponse, OfferUtxoDto, ParticipantDto,
};
use crate::api::offers::handlers as offer_handlers;
use crate::api::openapi_schemas::OfferDetailsResponseSchema;
use crate::api::params::{OfferSortBy, SortDir};

use crate::models::{FactoryStatus, OfferStatus, ParticipantType, UtxoType};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Simplicity Lending Indexer",
        version = "0.1.0",
        description = "REST API for the Simplicity Lending protocol indexer."
    ),
    paths(
        offer_handlers::list_offers,
        offer_handlers::get_ids_by_script,
        offer_handlers::get_details,
        borrower_handlers::get_by_script,
        factory_handlers::get_by_script,
        factory_handlers::get_by_id,
    ),
    components(schemas(
        AssetAmount,
        BorrowerDashboardResponse,
        BorrowerOverview,
        ErrorBody,
        ErrorResponse,
        FactoryAuthUtxoDto,
        FactoryDetailsResponse,
        FactoryProgramUtxoDto,
        FactoryStatus,
        OfferDetailsResponseSchema,
        OfferListItemShort,
        OfferListResponse,
        OfferSortBy,
        OfferStatus,
        OfferUtxoDto,
        ParticipantDto,
        ParticipantType,
        SortDir,
        UtxoType,
    )),
    tags(
        (name = "offers", description = "Lending offer queries"),
        (name = "borrowers", description = "Borrower dashboard"),
        (name = "factories", description = "Issuance factory queries"),
    )
)]
pub struct ApiDoc;

#[cfg(test)]
mod tests {
    use utoipa::OpenApi;

    use super::ApiDoc;

    #[test]
    fn openapi_spec_contains_all_endpoints() {
        let spec = ApiDoc::openapi();
        let paths = spec.paths.paths;

        assert!(paths.contains_key("/offers"));
        assert!(paths.contains_key("/offers/by-script"));
        assert!(paths.contains_key("/offers/{id}"));
        assert!(paths.contains_key("/borrowers/by-script"));
        assert!(paths.contains_key("/factories/by-script"));
        assert!(paths.contains_key("/factories/{id}"));
    }

    #[test]
    fn openapi_spec_serializes_to_json() {
        let json = serde_json::to_string(&ApiDoc::openapi()).expect("serialize openapi");
        assert!(json.contains("Simplicity Lending Indexer"));
        assert!(json.contains("collateral_amount"));
    }
}
