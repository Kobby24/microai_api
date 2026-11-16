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
