# Build-time installer for the R packages used by affy_mas5.R.
# Run once during `docker build`; never at request time. Any failure exits non-zero
# so the image build (and therefore the deploy) fails instead of shipping a broken runtime.
options(repos = c(CRAN = "https://cloud.r-project.org"), warn = 2)

if (!requireNamespace("BiocManager", quietly = TRUE)) {
  install.packages("BiocManager")
}

# affy:       ReadAffy() + mas5()
# hgu133acdf: CDF environment for GPL96 / HG-U133A arrays (needed by ReadAffy/mas5)
required <- c("affy", "hgu133acdf")

for (pkg in required) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    BiocManager::install(pkg, ask = FALSE, update = FALSE)
  }
}

# warn = 2 above makes failed installs fatal. Loading hgu133acdf emits harmless
# "replacing previous import" warnings, so verify with normal warning handling.
options(warn = 1)

for (pkg in required) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    message("Missing R package after installation: ", pkg)
    quit(status = 1)
  }
  message(pkg, " ", as.character(packageVersion(pkg)))
}

suppressPackageStartupMessages({
  library(affy)
  library(hgu133acdf)
})
message("R package installation verified.")

# Export the HG-U133A probe map as a plain RDS. Loading the hgu133acdf *package*
# pulls in AnnotationDbi (+DBI/RSQLite/S4Vectors...), which costs ~265 MB of RAM at
# runtime; affy_mas5.R registers this RDS as the "HG-U133A" CDF environment instead,
# giving bit-identical MAS5 output at roughly half the peak memory.
cdf_rds <- Sys.getenv("MICROAI_CDF_RDS", "/usr/local/share/microai/hgu133acdf.rds")
dir.create(dirname(cdf_rds), recursive = TRUE, showWarnings = FALSE)
saveRDS(as.list(hgu133acdf, all.names = TRUE), cdf_rds)
if (!file.exists(cdf_rds) || length(readRDS(cdf_rds)) < 20000) {
  message("Failed to export the HG-U133A CDF environment to ", cdf_rds)
  quit(status = 1)
}
message("Exported HG-U133A CDF environment to ", cdf_rds)
