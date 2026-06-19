use utoipa::OpenApi;

#[cfg(feature = "swagger-ui")]
use utoipa_swagger_ui::SwaggerUi;

use crate::api::borrowers::dto::{AssetAmount, BorrowerOverview};
use crate::api::borrowers::handlers as borrower_handlers;
use crate::api::factories::dto::{
    FactoryAuthUtxoDto, FactoryDetailsResponse, FactoryProgramUtxoDto,
};
use crate::api::factories::handlers as factory_handlers;
use crate::api::lenders::dto::LenderOverview;
use crate::api::lenders::handlers as lender_handlers;
use crate::api::offers::dto::{
    OfferListItemShort, OfferListResponse, OfferUtxoDto, OfferUtxoOutpointShort, ParticipantDto,
    ParticipantShort,
};
use crate::api::offers::handlers as offer_handlers;
use crate::api::params::{OfferSortBy, SortDir};
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
        borrower_handlers::get_overview_by_script,
        borrower_handlers::list_offers_by_script,
        lender_handlers::get_overview_by_script,
        lender_handlers::list_offers_by_script,
        factory_handlers::get_by_script,
        factory_handlers::get_by_id,
    ),
    components(schemas(
        AssetAmount,
        BorrowerOverview,
        ErrorBody,
        ErrorResponse,
        FactoryAuthUtxoDto,
        FactoryDetailsResponse,
        FactoryProgramUtxoDto,
        FactoryStatus,
        LenderOverview,
        OfferDetailsResponseSchema,
        OfferListItemShort,
        OfferListResponse,
        OfferSortBy,
        OfferStatus,
        OfferUtxoDto,
        OfferUtxoOutpointShort,
        ParticipantDto,
        ParticipantShort,
        ParticipantType,
        SortDir,
        UtxoType,
    )),
    tags(
        (name = "offers", description = "Lending offer queries"),
        (name = "borrowers", description = "Borrower queries"),
        (name = "lenders", description = "Lender queries"),
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
        assert!(paths.contains_key("/borrowers/overview"));
        assert!(paths.contains_key("/borrowers/offers"));
        assert!(paths.contains_key("/lenders/overview"));
        assert!(paths.contains_key("/lenders/offers"));
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

    #[test]
    fn borrower_offers_has_flat_query_params() {
        let spec = ApiDoc::openapi();
        let path = spec
            .paths
            .paths
            .get("/borrowers/offers")
            .expect("borrowers offers path");
        let get = path.get.as_ref().expect("GET operation");
        let params = get.parameters.as_ref().expect("query parameters");

        let names: Vec<String> = params.iter().map(|p| p.name.clone()).collect();

        assert!(names.contains(&"script_pubkey".to_string()));
        assert!(names.contains(&"status".to_string()));
        assert!(!names.iter().any(|n| n == "filters"));
    }

    #[test]
    fn openapi_operation_ids_are_unique() {
        let spec = ApiDoc::openapi();
        let mut seen = std::collections::HashMap::<String, String>::new();

        for (path, item) in &spec.paths.paths {
            let operations = [
                ("get", item.get.as_ref()),
                ("post", item.post.as_ref()),
                ("put", item.put.as_ref()),
                ("patch", item.patch.as_ref()),
                ("delete", item.delete.as_ref()),
            ];

            for (method, operation) in operations {
                let Some(operation) = operation else {
                    continue;
                };

                let operation_id = operation
                    .operation_id
                    .as_ref()
                    .unwrap_or_else(|| panic!("{method} {path} must declare operation_id"));

                if let Some(previous_path) = seen.insert(operation_id.clone(), path.clone()) {
                    panic!("duplicate operation_id `{operation_id}` on {path} and {previous_path}");
                }
            }
        }
    }
}
