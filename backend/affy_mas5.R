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

library(affy)

cel_data <- ReadAffy(filenames = cel_path, compress = TRUE)
processed <- mas5(cel_data, normalize = TRUE, sc = 600)
log_expression <- log2(exprs(processed))

feature_ids <- rownames(log_expression)
values <- as.numeric(log_expression[, 1])

# Release the AffyBatch / ExpressionSet before building the JSON to lower peak memory.
rm(cel_data, processed, log_expression)
invisible(gc())

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
