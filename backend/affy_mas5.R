args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1) {
  stop("Expected a single CEL file path.")
}

cel_path <- args[1]
if (!file.exists(cel_path)) {
  stop(sprintf("CEL file not found: %s", cel_path))
}

if (!requireNamespace("affy", quietly = TRUE)) {
  stop("The affy package is required for MAS5 preprocessing.")
}

# affy (mas5) prints progress text to stdout; divert it to stderr so stdout
# carries only the JSON payload parsed by main.run_affy_preprocessing().
sink(stderr())

# Progress markers for live status updates. message() writes to stderr only, so the
# JSON on stdout and every computation below are unchanged. r_runtime.py turns these
# lines (plus affy's own "N ids to be processed" line) into processing-stage events.
stage <- function(name) message("MICROAI_STAGE ", name)

stage("loading_affy")
library(affy)

# Memory: register the pre-exported HG-U133A probe map (see install_r_packages.R)
# in .GlobalEnv under the array's CDF name. affy's default lookup checks the global
# environment before attaching the hgu133acdf package, so AnnotationDbi never loads
# (~310 MB peak instead of ~600 MB). Other array types fall back to package lookup.
cdf_rds <- Sys.getenv("MICROAI_CDF_RDS", "/usr/local/share/microai/hgu133acdf.rds")
if (file.exists(cdf_rds)) {
  assign(
    "HG-U133A",
    list2env(readRDS(cdf_rds), envir = new.env(hash = TRUE, size = 30000L)),
    envir = .GlobalEnv
  )
} else {
  message("MAS5: ", cdf_rds, " not found; falling back to the hgu133acdf package (higher memory).")
}

stage("reading_cel")
cel_data <- ReadAffy(filenames = cel_path, compress = TRUE)
stage("mas5")
processed <- mas5(cel_data, normalize = TRUE, sc = 600)
stage("extracting")
log_expression <- log2(exprs(processed))

feature_ids <- rownames(log_expression)
values <- as.numeric(log_expression[, 1])

# Release the AffyBatch / ExpressionSet before building the JSON to lower peak memory.
rm(cel_data, processed, log_expression)
invisible(gc())

stage("exporting")
sink()

escaped_ids <- vapply(feature_ids, function(id) {
  gsub('"', '\\"', id)
}, character(1))

payload <- sprintf(
  '{"feature_ids":[%s],"values":[%s]}',
  paste(sprintf('"%s"', escaped_ids), collapse = ","),
  paste(values, collapse = ",")
)
cat(payload)
