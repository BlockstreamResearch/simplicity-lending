use utoipa::OpenApi;

#[cfg(feature = "swagger-ui")]
use utoipa_swagger_ui::SwaggerUi;

use crate::api::borrowers::dto::{AssetAmount, BorrowerDashboardResponse, BorrowerOverview};
use crate::api::borrowers::handlers as borrower_handlers;
use crate::api::factories::dto::{
    FactoryAuthUtxoDto, FactoryDetailsResponse, FactoryProgramUtxoDto,
};
use crate::api::factories::handlers as factory_handlers;
use crate::api::offers::dto::{
    OfferListItemShort, OfferListResponse, OfferUtxoDto, ParticipantDto,
};
use crate::api::offers::handlers as offer_handlers;
use crate::api::params::{BorrowerDashboardQuery, OfferFilters, OfferSortBy, SortDir};

use crate::models::{FactoryStatus, OfferStatus, ParticipantType, UtxoType};

use super::schemas::{ErrorBody, ErrorResponse, OfferDetailsResponseSchema};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Simplicity Lending Indexer",
        version = env!("CARGO_PKG_VERSION"),
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
        BorrowerDashboardQuery,
        BorrowerDashboardResponse,
        BorrowerOverview,
        ErrorBody,
        ErrorResponse,
        FactoryAuthUtxoDto,
        FactoryDetailsResponse,
        FactoryProgramUtxoDto,
        FactoryStatus,
        OfferDetailsResponseSchema,
        OfferFilters,
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

#[cfg(feature = "swagger-ui")]
pub fn swagger_routes() -> SwaggerUi {
    SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi())
}

#[cfg(test)]
mod tests {
    use super::ApiDoc;
    use utoipa::OpenApi;

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
    fn openapi_spec_uses_crate_version() {
        let spec = ApiDoc::openapi();
        assert_eq!(spec.info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn openapi_spec_serializes_to_json() {
        let json = serde_json::to_string(&ApiDoc::openapi()).expect("serialize openapi");
        assert!(json.contains("Simplicity Lending Indexer"));
        assert!(json.contains("collateral_amount"));
    }
}
