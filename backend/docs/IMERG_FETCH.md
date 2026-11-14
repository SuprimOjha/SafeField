# Install the latest available GPM IMERG Late Run data

The assessment API reads only the local SQLite grid cache. It never logs in to NASA or downloads a file while serving a farmer request.

## One-time setup

1. Create a free [NASA Earthdata Login](https://urs.earthdata.nasa.gov/users/new) account.
2. Authorize the GES DISC application from the [NASA GES DISC portal](https://disc.gsfc.nasa.gov/) when prompted.
3. From the repository's `backend` directory, install requirements and run:

```powershell
python -m pip install -r requirements.txt
python -m app.cli fetch-imerg
```

The command prompts for the Earthdata username and then the password. Password input is hidden. Credentials are held only in the current Python process environment for this run; the command does not write them to `.env`, a config file, or the repository. Do not paste credentials into chat or commit them.

## Fetch the latest available day

The default `--days 1` searches completed UTC dates from newest to oldest and installs the single most recent daily IMERG Late granule it can find. If the latest day has not been published yet, it automatically checks up to five additional completed UTC days. The observed UTC date is included in the result. This means the date is determined by NASA's actual granule availability, not by a hard-coded calendar date.

To install the seven most recent available daily granules instead:

```powershell
python -m app.cli fetch-imerg --days 7
```

The command searches GPM_3IMERGDL collection version 07 (V07B algorithm line), crops the grid to Nepal's configured bounding box and stores usable daily cells in the existing SQLite cache. It prints variable names and stops if the expected `precipitation` or `precipitation_cnt` variable is missing or the precipitation unit is unexpected. The `precipitation_cnt` variable records the number of valid half-hourly samples (up to 48 per UTC day).

## Dataset facts and limitations

- Product: GPM IMERG Late daily, `GPM_3IMERGDL`, CMR collection version `07` (NASA's current algorithm line is V07B).
- Daily precipitation field: `precipitation`, in mm/day; valid-sample count: `precipitation_cnt` (up to 48 half-hourly samples per UTC day). Point estimates require at least 39 samples. Polygon coverage weights each intersected cell area by sample_count/48 and requires at least 80% effective coverage on each day. These are conservative software quality gates, not NASA quality flags.
- Grid: 0.1° (~10 km). The cache stores 0.1° grid-cell centres and treats them as cell footprints for equal-area polygon intersection. This is a grid-derived screening estimate, not a surveyed field boundary measurement.
- NASA lists a nominal minimum latency of about 12 hours for IMERG Late. Actual publication can be delayed; this fetcher checks real catalogue availability and records the observation date separately from fetch time.
- The current V07 daily Late product is kept separate from V07 Final research data. Re-check NASA CMR and product metadata for collection/version changes before a later deployment; the code deliberately fails closed if variable names/units change.

Sources: [NASA GPM precipitation data directory](https://gpm.nasa.gov/data/directory), [NASA IMERG V07 FAQ](https://gpm.nasa.gov/sites/default/files/2025-02/FAQ%20for%20IMERG%20V07%20Applications%20Users_202502.pdf), [earthaccess API documentation](https://earthaccess.readthedocs.io/en/stable/api/).

Live NASA authentication, CMR availability and a real download must be verified on the user's machine; synthetic unit tests do not validate upstream availability or scientific accuracy.
