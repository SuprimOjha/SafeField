# Install GPM IMERG Late Run data

The assessment API reads only the local SQLite grid cache. It never logs in to NASA or downloads a file while serving a farmer request.

## One-time setup

1. Register for a free NASA Earthdata Login account and authorize the GES DISC application.
2. Add your credentials to the root `.env` file (never commit it):

```dotenv
EARTHDATA_USERNAME=your_earthdata_username
EARTHDATA_PASSWORD=your_earthdata_password
```

3. Install backend requirements and run the single fetch command from the repository's `backend` directory:

```powershell
python -m pip install -r requirements.txt
python -m app.cli fetch-imerg --days 7
```

The command searches the most recent completed UTC days, walks back up to five additional days when granules are not yet available, downloads GPM_3IMERGDL collection version 07, crops the grid to Nepal's configured bounding box and stores usable daily cells in the existing SQLite cache. It prints variable names and stops if the expected `precipitation` or `precipitation_cnt` variable is missing or the precipitation unit is unexpected. The precipitation_cnt variable records the number of valid half-hourly samples (up to 48 per day).

## Dataset facts and limitations

- Product: GPM IMERG Late daily, `GPM_3IMERGDL`, CMR collection version `07` (NASA GPM currently documents the V07B algorithm line).
- Daily precipitation field: `precipitation`, in mm/day; valid-sample count: `precipitation_cnt` (up to 48 half-hourly samples per UTC day). Point estimates require at least 39 samples. Polygon coverage weights each intersected cell area by sample_count/48 and requires at least 80% effective coverage on each day. These are conservative software quality gates, not NASA quality flags.
- Grid: 0.1° (~10 km). The cache stores 0.1° grid-cell centres and treats them as cell footprints for equal-area polygon intersection. This is a grid-derived screening estimate, not a surveyed field boundary measurement.
- The observed UTC date is stored separately from fetch time. NASA describes Late processing as about 14 hours after observation; the expected daily-data lag is roughly 14–38 hours, but the actual observation interval is authoritative. Never label fetch time as observation time.
- The current V07 daily Late product is kept separate from V07 Final research data. Re-check NASA CMR and product metadata for collection/version changes before a later deployment; the code deliberately fails closed if variable names/units change.

Sources: [NASA GPM precipitation data directory](https://gpm.nasa.gov/data/directory), [NASA IMERG V07 FAQ](https://gpm.nasa.gov/sites/default/files/2025-02/FAQ%20for%20IMERG%20V07%20Applications%20Users_202502.pdf), [earthaccess API documentation](https://earthaccess.readthedocs.io/en/stable/api/).

Live NASA authentication, CMR availability and a real download must be verified on the user's machine; synthetic unit tests do not validate upstream availability or scientific accuracy.
